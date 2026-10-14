import { config as loadDotenv } from 'dotenv';

// This module is reached from app.module.ts's own import graph (via
// ClusterBus/typeorm.module.ts) before app.module.ts's body runs
// ConfigModule.forRoot() - so under `nest start`/`start:dev` (no
// `--env-file`), the read below would otherwise always see CLUSTER_WORKERS
// as unset. Loading it here directly makes this module self-sufficient
// regardless of how the process was started; harmless under `--env-file`
// or ConfigModule's own dotenv call too, since dotenv never overwrites a
// var that's already set. `quiet` skips dotenv's own "injected env" log -
// this app's own Nest logger is the only thing that should write to stdout
// on boot.
loadDotenv({ quiet: true });

/**
 * Sharding is opt-in and off by default - CLUSTER_WORKERS unset (or `1`)
 * means every `ownerIndex`/`isMine` check is trivially true and this whole
 * module is a no-op, so single-process dev/test behavior is unchanged.
 */
export const CLUSTER_WORKERS = Math.max(1, Number(process.env.CLUSTER_WORKERS ?? 1));

/** Set by the primary on each forked worker's env before it boots - see cluster-primary.ts. */
export const WORKER_INDEX = Number(process.env.CLUSTER_WORKER_INDEX ?? 0);

export const CLUSTERING_ENABLED = CLUSTER_WORKERS > 1;

// djb2's own standard seed and multiplier - fast, good-enough distribution
// for UUIDs/opaque ids, not security-sensitive (ownership routing, not
// auth). Fixed by the algorithm, not a value this app chose.
const DJB2_SEED = 5381;
const DJB2_MULTIPLIER = 33;

/**
 * The worker index (0-based, stable for the process's lifetime - not
 * Node's own auto-incrementing `cluster.worker.id`, which changes on
 * restart) that owns a given sharding key. Every worker computes this the
 * same way independently, so there's no coordination needed to find out
 * who owns what - just a pure function of the key.
 */
export function ownerIndex(key: string): number {
  let hash = DJB2_SEED;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * DJB2_MULTIPLIER) ^ key.charCodeAt(i);
  }
  return Math.abs(hash) % CLUSTER_WORKERS;
}

export function isMine(key: string): boolean {
  return !CLUSTERING_ENABLED || ownerIndex(key) === WORKER_INDEX;
}
