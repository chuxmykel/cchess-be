#!/usr/bin/env node
// Variant of load-test.mjs for an ALREADY-RUNNING server (local or remote) -
// used for the 2-machine scaling test (one real server per machine, driven
// concurrently). Does not spawn or manage a server process, so no RSS
// sampling or server log capture either - purely the client-side load
// generator against a given BASE_URL. Not part of the test suite:
//
//   BASE_URL=http://192.168.1.183:4900 node scripts/load-test/load-test-remote.mjs 500
//
// Shared simulation logic lives in load-test-lib.mjs, reused by
// load-test.mjs (which spawns and owns its own server process).
import { createLogger, runSimulation, SCRIPT } from './load-test-lib.mjs';

const GAMES = Number(process.argv[2] ?? 10);
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4100';
const TC_MINUTES = Number(process.env.TC_MINUTES ?? 5);
const TC_INCREMENT_SECONDS = Number(process.env.TC_INCREMENT_SECONDS ?? 0);
const CONCURRENCY = 100;

const log = createLogger(`[load-test-remote ${BASE_URL}]`);

async function main() {
  log.info(`simulating ${GAMES} games (${GAMES * 2} players, ${SCRIPT.length} plies each) against an already-running server`);

  const metrics = await runSimulation({
    baseUrl: BASE_URL,
    log,
    games: GAMES,
    tcMinutes: TC_MINUTES,
    tcIncrementSeconds: TC_INCREMENT_SECONDS,
    concurrency: CONCURRENCY,
  });

  console.log(`\n=== RESULTS (${BASE_URL}) ===`);
  console.log(JSON.stringify(metrics, null, 2));
}

await main();
process.exit(0);
