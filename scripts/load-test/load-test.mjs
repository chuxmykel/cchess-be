#!/usr/bin/env node
// Load test: boots the real server as a child process, then simulates N
// concurrent games end-to-end (guest auth -> socket connect -> matchmaking
// seek -> a scripted legal opening played move-by-move over the realtime
// gateway -> resignation), measuring wall-clock time and server RSS (Resident Set Size) memory
// at each phase. Not part of the test suite - run manually:
//
//   node scripts/load-test/load-test.mjs 100
//
// Shared simulation logic (guest auth, socket play, latency tracking) lives
// in load-test-lib.mjs, reused by load-test-remote.mjs for an
// already-running server; spawning/tearing down the server process lives in
// load-test-server.mjs - this file is just the two wired together.
import { createGuest, createLogger, runSimulation } from './load-test-lib.mjs';
import { spawnLoadTestServer } from './load-test-server.mjs';

const GAMES = Number(process.argv[2] ?? 10);
const PORT = Number(process.argv[3] ?? 4100);
// Dedicated database - never point this at a real dev/prod DB_NAME; the
// server truncates nothing itself, so every run just accumulates more rows
// here. Create it once: `createdb cchess_be_loadtest --owner=cchess`.
const DB_NAME = process.argv[4] ?? 'cchess_be_loadtest';
// Defaults to blitz (5+0), matching every prior run in this project's
// reports - override to test a different time control, e.g. bullet:
// TC_MINUTES=1 TC_INCREMENT_SECONDS=0 node scripts/load-test/load-test.mjs ...
const TC_MINUTES = Number(process.env.TC_MINUTES ?? 5);
const TC_INCREMENT_SECONDS = Number(process.env.TC_INCREMENT_SECONDS ?? 0);
const BASE_URL = `http://localhost:${PORT}`;
const CONCURRENCY = 100; // cap on simultaneous in-flight HTTP requests while provisioning

const log = createLogger('[load-test]');

/** On failure, fetches the first few games the harness never saw finish, so
 * the console output shows what state they were actually stuck in (whose
 * turn, how many moves landed) rather than just "timed out". */
async function reportStuckGames(error) {
  const token = (await createGuest(BASE_URL)).accessToken;
  const notified = error.notifiedGameIds ?? new Set();
  const finished = error.finishedGameIds ?? new Set();
  const stuckIds = [...notified].filter((id) => !finished.has(id)).slice(0, 5);
  log.error(`--- inspecting ${stuckIds.length} stuck games via REST ---`);
  for (const id of stuckIds) {
    const res = await fetch(`${BASE_URL}/games/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    log.error(id, {
      status: body.status,
      turn: body.turn,
      movesPlayed: body.moves?.length,
      lastMoveAt: body.lastMoveAt,
    });
  }
}

/** Runs the simulation against `server`, sampling its RSS at both the
 * after-connect and after-games checkpoints, and prints the results. */
async function runLoadTest(server) {
  let rssAfterConnectKb;
  const metrics = await runSimulation({
    baseUrl: BASE_URL,
    log,
    games: GAMES,
    tcMinutes: TC_MINUTES,
    tcIncrementSeconds: TC_INCREMENT_SECONDS,
    concurrency: CONCURRENCY,
    onSocketsConnected: async () => {
      rssAfterConnectKb = await server.getRss();
      log.info(`server RSS after connect=${rssAfterConnectKb}KB`);
    },
  });
  metrics.rssAfterConnectKb = rssAfterConnectKb;
  metrics.rssAfterGamesKb = await server.getRss();
  log.info(`server RSS after games=${metrics.rssAfterGamesKb}KB`);

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(metrics, null, 2));
}

async function main() {
  log.info(
    `starting server on :${PORT}, db=${DB_NAME}, simulating ${GAMES} games (${GAMES * 2} players)`,
  );
  const server = spawnLoadTestServer({ port: PORT, dbName: DB_NAME });

  try {
    await runLoadTest(server);
  } catch (error) {
    log.error('LOAD TEST FAILED:', error);
    log.error(
      `${error.unexpectedDisconnectCount ?? 0} games had a socket disconnect before finishing, reasons=${JSON.stringify(error.disconnectReasons ?? {})}`,
    );
    const warnings = server
      .getLog()
      .split('\n')
      .filter((l) => /ERROR|WARN/.test(l))
      .slice(-60);
    log.error(`--- last ${warnings.length} WARN/ERROR server log lines ---`);
    log.error(warnings.join('\n'));

    try {
      await reportStuckGames(error);
    } catch (diagErr) {
      log.error('diagnostic fetch failed:', diagErr);
    }

    process.exitCode = 1;
  } finally {
    await server.teardown();
  }
}

await main();
// Something always keeps the event loop alive after this point (undici's
// keep-alive connection pool from the guest-creation fetch() calls, and/or
// socket.io-client internals that don't fully unref after .disconnect()),
// so without a hard exit here the process just hangs forever instead of
// returning to the shell - confirmed by stale load-test processes lingering
// (and holding onto memory) long after printing their results.
process.exit(process.exitCode ?? 0);
