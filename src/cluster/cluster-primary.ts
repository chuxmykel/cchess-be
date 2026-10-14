import cluster from 'node:cluster';

interface ToMessage {
  to: number;
}

function hasNumericTo(value: unknown): value is ToMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ToMessage).to === 'number'
  );
}

// If a worker keeps dying faster than this, it's not a transient blip
// (lost DB connection, OOM under a load spike) but something fundamentally
// broken (bad migration, crash-on-boot bug) - respawning forever in that
// case just burns CPU forking and spams logs without ever recovering, so
// give up on that index past this many exits within the window below.
const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 60_000;

/**
 * Runs only in the primary process when CLUSTER_WORKERS > 1 (see main.ts) -
 * forks one worker per shard, assigns each a stable 0-based
 * CLUSTER_WORKER_INDEX (not Node's own `cluster.worker.id`, which isn't
 * stable across a worker restart), and relays our own ClusterBus's
 * request/response messages between workers, since Node's cluster IPC only
 * connects each worker to the primary, not to each other directly.
 *
 * Socket.IO's own cross-worker room broadcast does NOT go through this
 * relay - it rides over Redis pub/sub instead (see cluster-io-adapter.ts).
 * An earlier version used `@socket.io/cluster-adapter`'s plain-IPC relay
 * for that too, sharing this same channel; load testing found it silently
 * dropped broadcasts under concurrent load (confirmed this channel itself
 * wasn't the problem - ClusterBus's own request/response traffic here
 * never lost a message under the same load), so that part moved to Redis.
 */
export function runClusterPrimary(numWorkers: number): void {
  const workersByIndex = new Map<number, ReturnType<typeof cluster.fork>>();
  // Timestamps of recent exits per index - see MAX_RESTARTS_PER_WINDOW.
  const recentExitsByIndex = new Map<number, number[]>();

  function forkWorker(index: number): void {
    const worker = cluster.fork({ CLUSTER_WORKER_INDEX: String(index) });
    workersByIndex.set(index, worker);
    // eslint-disable-next-line no-console
    console.log(`cluster worker ${index} forked (pid ${worker.process.pid})`);

    worker.on('message', (msg: unknown) => {
      if (!hasNumericTo(msg)) return;
      const target = workersByIndex.get(msg.to);
      target?.send(msg);
    });
  }

  for (let index = 0; index < numWorkers; index++) {
    forkWorker(index);
  }

  cluster.on('exit', (worker, code, signal) => {
    const index = [...workersByIndex.entries()].find(
      ([, w]) => w === worker,
    )?.[0];
    workersByIndex.delete(index ?? -1);

    if (index === undefined) {
      // eslint-disable-next-line no-console
      console.error(
        `unknown cluster worker (pid ${worker.process.pid}) exited (code=${code}, signal=${signal})`,
      );
      return;
    }

    const now = Date.now();
    const recentExits = (recentExitsByIndex.get(index) ?? []).filter(
      (t) => now - t < RESTART_WINDOW_MS,
    );
    recentExits.push(now);
    recentExitsByIndex.set(index, recentExits);

    if (recentExits.length > MAX_RESTARTS_PER_WINDOW) {
      // eslint-disable-next-line no-console
      console.error(
        `cluster worker ${index} (pid ${worker.process.pid}) exited (code=${code}, signal=${signal}) - ` +
          `crashed ${recentExits.length} times in the last ${RESTART_WINDOW_MS}ms, giving up on this shard; ` +
          `fix the underlying issue and restart the whole process`,
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.error(
      `cluster worker ${index} (pid ${worker.process.pid}) exited (code=${code}, signal=${signal}) - respawning`,
    );
    forkWorker(index);
  });
}
