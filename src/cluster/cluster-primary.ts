import cluster from 'node:cluster';

interface ToMessage {
  to: number;
}

function hasNumericTo(value: unknown): value is ToMessage {
  return typeof value === 'object' && value !== null && typeof (value as ToMessage).to === 'number';
}

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

  for (let index = 0; index < numWorkers; index++) {
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

  cluster.on('exit', (worker, code, signal) => {
    const index = [...workersByIndex.entries()].find(([, w]) => w === worker)?.[0];
    // eslint-disable-next-line no-console
    console.error(
      `cluster worker ${index ?? '?'} (pid ${worker.process.pid}) exited (code=${code}, signal=${signal}) - not respawned; restart the whole process`,
    );
  });
}
