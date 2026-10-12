// Spawns and tears down the real server as a child process for
// load-test.mjs - isolated here so load-test.mjs's main() reads as the
// simulation flow, not process plumbing. load-test-remote.mjs has no use
// for this (it drives an already-running server it doesn't own).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

function sampleRss(pid) {
  // Diagnostic only (server memory sampling) - must never abort the actual
  // load test, e.g. if this client process itself is under fd pressure from
  // thousands of open sockets and spawn() throws synchronously (EBADF). A
  // synchronous throw inside a Promise executor auto-rejects the promise
  // rather than escaping it, so the catch has to be in here, not around
  // the `new Promise(...)` call at the call site.
  return new Promise((resolve) => {
    try {
      const ps = spawn('ps', ['-o', 'rss=', '-p', String(pid)]);
      let out = '';
      ps.stdout.on('data', (d) => (out += d));
      ps.on('close', () => resolve(Number(out.trim()) || 0));
      ps.on('error', () => resolve(0));
    } catch {
      resolve(0);
    }
  });
}

/**
 * Boots `node dist/main.js` as a child process with load-test env vars,
 * capturing its combined stdout/stderr for post-mortem diagnostics. Returns
 * a handle rather than the raw child process: `getRss()` (current resident
 * memory), `getLog()` (everything printed so far), and `teardown()`
 * (persists the log to disk, sends SIGTERM, and waits for the port to
 * actually free up before returning - a load test run back-to-back against
 * the same port can otherwise race the previous instance's shutdown).
 */
export function spawnLoadTestServer({ port, dbName }) {
  const proc = spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_NAME: dbName,
      JWT_ACCESS_SECRET: 'load-test',
      JWT_REFRESH_SECRET: 'load-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));

  return {
    pid: proc.pid,
    getLog: () => log,
    getRss: () => sampleRss(proc.pid),
    async teardown() {
      writeFileSync('scripts/load-test/.last-load-test-server.log', log);
      proc.kill('SIGTERM');
      await sleep(300);
    },
  };
}
