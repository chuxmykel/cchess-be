// Shared logic between load-test.mjs (spawns its own server) and
// load-test-remote.mjs (drives an already-running one): the actual game
// simulation - guest auth, socket connect, matchmaking, scripted play,
// latency tracking - is identical either way. Not part of the test suite.
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';

// A real, fully legal 40-ply opening - identical for every game, so every
// pair of sockets can play it blind without any chess logic on the client
// side. Extended past the original 10-ply Ruy Lopez to exercise longer-lived
// games (more sustained concurrent load per run, not just a burst).
export const SCRIPT = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['g1', 'f3'], ['b8', 'c6'],
  ['f1', 'b5'], ['a7', 'a6'],
  ['b5', 'a4'], ['g8', 'f6'],
  ['e1', 'g1'], ['f8', 'e7'],
  ['d2', 'd4'], ['h7', 'h6'],
  ['d1', 'e1'], ['c6', 'a5'],
  ['c1', 'h6'], ['f6', 'h7'],
  ['c2', 'c3'], ['h8', 'f8'],
  ['h6', 'g5'], ['b7', 'b5'],
  ['a4', 'b3'], ['e5', 'd4'],
  ['g2', 'g4'], ['h7', 'g5'],
  ['f3', 'd4'], ['c7', 'c5'],
  ['d4', 'f5'], ['g5', 'h3'],
  ['g1', 'h1'], ['c5', 'c4'],
  ['b3', 'c2'], ['d7', 'd6'],
  ['e1', 'e3'], ['a8', 'a7'],
  ['c2', 'd1'], ['h3', 'g1'],
  ['d1', 'c2'], ['c8', 'b7'],
  ['e3', 'h6'], ['f7', 'f6'],
];

// .info/.error mirror the same prefix onto stdout/stderr respectively -
// failure diagnostics (.error) stay on a separate stream from stdout's
// results JSON, which a caller may pipe through something like `jq`.
export function createLogger(prefix) {
  return {
    info: (...args) => console.log(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

export function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

/** Summarizes a set of {atMs, latencyMs} samples: overall percentiles, plus
 * the same percentiles split into quarters of the run's wall-clock duration,
 * so a degrading-under-sustained-load pattern is visible even when the
 * overall numbers look fine. */
export function summarizeLatencies(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a.latencyMs - b.latencyMs);
  const values = sorted.map((s) => s.latencyMs);
  const overall = {
    count: values.length,
    meanMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    maxMs: values[values.length - 1],
  };

  // Bucketed by position within the samples' OWN time span (not from script
  // start) - otherwise setup/connect time that isn't part of move-play
  // dilutes the span and skews every sample into the last bucket.
  // Min/max via a plain loop, not Math.min/max(...ats) - spreading a large
  // array as call arguments blows V8's argument-count limit (hit this for
  // real at 20,000 games: 200,000 samples raised "Maximum call stack size
  // exceeded" here, after a multi-minute run had already completed).
  let minAt = Infinity;
  let maxAt = -Infinity;
  for (const s of samples) {
    if (s.atMs < minAt) minAt = s.atMs;
    if (s.atMs > maxAt) maxAt = s.atMs;
  }
  const span = maxAt - minAt || 1;
  const byQuarter = [[], [], [], []];
  for (const s of samples) {
    const q = Math.min(3, Math.floor(((s.atMs - minAt) / span) * 4));
    byQuarter[q].push(s.latencyMs);
  }
  const quarters = byQuarter.map((q, i) => {
    const qs = [...q].sort((a, b) => a - b);
    return qs.length === 0
      ? { quarter: i + 1, count: 0 }
      : { quarter: i + 1, count: qs.length, p50: percentile(qs, 50), p95: percentile(qs, 95) };
  });

  return { overall, byQuarterOfRun: quarters };
}

export async function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('server did not become healthy in time');
}

export async function pooled(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function createGuest(baseUrl) {
  const res = await fetch(`${baseUrl}/auth/guest`, { method: 'POST' });
  if (!res.ok) throw new Error(`guest creation failed: ${res.status}`);
  const body = await res.json();
  return { accessToken: body.accessToken, userId: body.user.id };
}

export function connectSocket(baseUrl, accessToken) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 15_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Drives one socket through: seek -> play its half of SCRIPT -> resign/accept end. */
export function runPlayer(socket, log, { onGameReady, onGameOver, onDisconnect, onMoveLatency }) {
  let color = null;
  let gameId = null;
  let nextPly = 0;
  // Set right before we emit our own move, cleared once its echo comes back -
  // this is what lets the 'game:move' listener below tell "the broadcast
  // confirming MY move" apart from "notification of the opponent's move",
  // which arrives on the exact same event with no other distinguishing field.
  let moveSentAt = null;

  function maybePlay() {
    if (!color || nextPly >= SCRIPT.length) return;
    // A move already in flight (awaiting its own echo) must not be
    // re-sent - 'game:join's 'game:state' reply and a 'game:move' broadcast
    // are two independent round trips that can arrive out of order under
    // load, and both call maybePlay(); without this guard, a 'game:state'
    // reply delayed past a subsequent real move re-fires an emit for a ply
    // already submitted, which the server correctly (but confusingly)
    // rejects as "not your turn" once the real turn has moved on.
    if (moveSentAt !== null) return;
    const isMyTurn = (nextPly % 2 === 0) === (color === 'white');
    if (!isMyTurn) return;
    const [from, to] = SCRIPT[nextPly];
    moveSentAt = Date.now();
    socket.emit('game:move', { gameId, from, to });
  }

  socket.on('game:created', (state) => {
    gameId = state.id;
    color = state.white.id === socket.auth.userIdForTest ? 'white' : 'black';
    onGameReady?.(gameId);
    socket.emit('game:join', { gameId });
  });

  // The authoritative resync point: whatever ply the server says we're at
  // *right now*, as of our own join - not a guess based on when we joined
  // relative to the opponent. This is what makes join order/timing
  // irrelevant: a socket that joins after the opponent has already moved
  // picks up exactly where the game actually is instead of silently
  // missing a move broadcast it wasn't in the room for yet.
  socket.on('game:state', (state) => {
    // Never regress: 'game:join's round trip can be slower than a
    // subsequent 'game:move' broadcast under load, so a 'game:state' reply
    // can describe an already-superseded snapshot by the time it arrives.
    // Applying it unconditionally would roll nextPly backward and
    // re-trigger a move for a ply that's already been played.
    nextPly = Math.max(nextPly, state.moves.length);
    maybePlay();
  });

  socket.on('game:move', (payload) => {
    const serverPly = payload?.move?.ply; // 1-indexed; equals the move count once applied
    // A socket's permanent user:{id} room membership (since handleConnection,
    // well before this game even existed) means it can receive a game's
    // early move broadcasts through TWO overlapping channels: a live
    // 'game:move' push, and the 'game:state' snapshot fetched on 'game:join'
    // - whichever arrives second describes a ply this socket already knows
    // about. Tracking the server's own ply number (not blindly incrementing
    // a local counter) makes this idempotent regardless of which channel
    // delivers it first.
    if (typeof serverPly === 'number' && serverPly <= nextPly) return;
    // Only set when this echo is confirming a move THIS socket just made
    // (see moveSentAt comment above) - skip opponent-move notifications.
    if (moveSentAt !== null) {
      onMoveLatency?.(Date.now() - moveSentAt);
      moveSentAt = null;
    }
    nextPly = typeof serverPly === 'number' ? serverPly : nextPly + 1;
    if (nextPly >= SCRIPT.length) {
      // Whoever just moved last offers resignation to end the game cleanly.
      if (nextPly % 2 === 0 ? color === 'black' : color === 'white') {
        socket.emit('game:resign', { gameId });
      }
    } else {
      maybePlay();
    }
  });

  socket.on('game:over', (state) => {
    onGameOver?.(state);
  });

  socket.on('game:error', (err) => {
    log.info('game:error', err);
  });

  socket.on('disconnect', (reason) => {
    onDisconnect?.(reason, gameId);
  });
}

/**
 * Runs the full game-simulation body shared by both scripts: guest auth,
 * socket connect, matchmaking seek, scripted play, latency tracking. Takes
 * already-resolved config (baseUrl, log) rather than reading globals, so
 * each caller supplies its own BASE_URL resolution and log prefix.
 *
 * On any failure (health/matchmaking/play timeout), the thrown error carries
 * notifiedGameIds/finishedGameIds/disconnectReasons alongside the message -
 * callers that want server-log/RSS/stuck-game diagnostics read those off the
 * caught error rather than needing their own copy of this bookkeeping.
 * `onSocketsConnected` (optional) fires once all sockets are up, before any
 * game play starts - the one hook load-test.mjs needs to sample its spawned
 * server's RSS at a second checkpoint (baseline-with-connections, not just
 * after-all-games), which load-test-remote.mjs has no use for.
 */
export async function runSimulation({
  baseUrl,
  log,
  games,
  tcMinutes,
  tcIncrementSeconds,
  concurrency = 100,
  onSocketsConnected,
}) {
  const metrics = { games, phases: {} };
  const t0 = Date.now();
  const notifiedGameIds = new Set();
  const finishedGameIds = new Set();
  const unexpectedDisconnectGameIds = new Set();
  const disconnectReasons = {};
  const moveLatencies = [];

  try {
    await waitForHealth(baseUrl);
    metrics.phases.serverReadyMs = Date.now() - t0;

    const playerCount = games * 2;
    const t1 = Date.now();
    const guests = await pooled(Array.from({ length: playerCount }), concurrency, () => createGuest(baseUrl));
    metrics.phases.guestsCreatedMs = Date.now() - t1;
    log.info(`created ${guests.length} guest accounts in ${metrics.phases.guestsCreatedMs}ms`);

    const t2 = Date.now();
    const sockets = await pooled(guests, concurrency, async (g) => {
      const socket = await connectSocket(baseUrl, g.accessToken);
      socket.auth.userIdForTest = g.userId;
      return socket;
    });
    metrics.phases.socketsConnectedMs = Date.now() - t2;
    log.info(`connected ${sockets.length} sockets in ${metrics.phases.socketsConnectedMs}ms`);
    await onSocketsConnected?.();

    let gamesCreated = 0;
    let gamesFinished = 0;
    let gamesCreatedResolve, gamesFinishedResolve;
    const allCreated = new Promise((r) => (gamesCreatedResolve = r));
    const allFinished = new Promise((r) => (gamesFinishedResolve = r));

    for (const socket of sockets) {
      runPlayer(socket, log, {
        onGameReady: (gameId) => {
          notifiedGameIds.add(gameId);
          gamesCreated += 1;
          if (gamesCreated === playerCount) gamesCreatedResolve();
        },
        onGameOver: (state) => {
          finishedGameIds.add(state.id);
          gamesFinished += 1;
          if (gamesFinished === playerCount) gamesFinishedResolve();
        },
        onDisconnect: (reason, gameId) => {
          disconnectReasons[reason] = (disconnectReasons[reason] ?? 0) + 1;
          if (gameId && !finishedGameIds.has(gameId)) unexpectedDisconnectGameIds.add(gameId);
        },
        onMoveLatency: (latencyMs) => moveLatencies.push({ atMs: Date.now() - t0, latencyMs }),
      });
    }

    const t3 = Date.now();
    // Kick things off: every socket seeks the same time control, so the
    // server's matchmaking pool pairs them up two at a time.
    for (const socket of sockets) {
      socket.emit('matchmaking:seek', { minutes: tcMinutes, incrementSeconds: tcIncrementSeconds });
    }

    const matchTimeoutMs = Math.max(20_000, games * 20);
    await Promise.race([
      allCreated,
      sleep(matchTimeoutMs).then(() => {
        throw new Error(`matchmaking timed out (${gamesCreated}/${playerCount} notified)`);
      }),
    ]);
    metrics.phases.allMatchedMs = Date.now() - t3;
    log.info(`all ${games} games matched in ${metrics.phases.allMatchedMs}ms`);

    const t4 = Date.now();
    const playTimeoutMs = Math.max(20_000, games * 150);
    const heartbeat = setInterval(() => {
      log.info(
        `progress: ${gamesCreated}/${playerCount} notified, ${gamesFinished}/${playerCount} finished, ` +
          `${unexpectedDisconnectGameIds.size} sockets disconnected pre-finish, reasons=${JSON.stringify(disconnectReasons)}`,
      );
    }, 2000);
    await Promise.race([
      allFinished,
      sleep(playTimeoutMs).then(() => {
        throw new Error(`game play timed out (${gamesFinished}/${playerCount} finished)`);
      }),
    ]).finally(() => clearInterval(heartbeat));
    metrics.phases.allFinishedMs = Date.now() - t4;
    log.info(`all ${games} games played + resigned in ${metrics.phases.allFinishedMs}ms`);

    metrics.unexpectedDisconnects = unexpectedDisconnectGameIds.size;
    metrics.disconnectReasons = disconnectReasons;
    metrics.totalMs = Date.now() - t0;
    metrics.gamesPerSecondMatching = games / (metrics.phases.allMatchedMs / 1000);
    metrics.movesPerSecondPlay = (games * SCRIPT.length) / (metrics.phases.allFinishedMs / 1000);
    // This is the number that actually matters for playability: how long a
    // player waits, per move, between making it and seeing it confirmed -
    // not the aggregate throughput above, which can look fine in sum while
    // individual moves (especially late in a saturated run) take seconds.
    metrics.moveLatencyMs = summarizeLatencies(moveLatencies);

    for (const socket of sockets) socket.disconnect();

    return metrics;
  } catch (error) {
    throw Object.assign(error, {
      notifiedGameIds,
      finishedGameIds,
      disconnectReasons,
      unexpectedDisconnectCount: unexpectedDisconnectGameIds.size,
    });
  }
}
