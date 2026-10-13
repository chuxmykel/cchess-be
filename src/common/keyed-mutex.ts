/**
 * Serializes async work per key so e.g. a move arriving at the exact instant
 * a clock's flag-fall timer fires can't both mutate the same game row at
 * once. Purely in-memory (a `Map`), so it only serializes work within a
 * single process - but that's still sufficient under `CLUSTER_WORKERS > 1`,
 * because ownership routing (`cluster.util.ts`'s `isMine`/`ownerIndex`)
 * already guarantees every mutating call for a given gameId is forwarded to
 * the one worker that owns it, so no other process ever contends for the
 * same key.
 */
export class KeyedMutex {
  private readonly queueTailByKey = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const priorTail = this.queueTailByKey.get(key) ?? Promise.resolve();
    const operation = priorTail.then(fn, fn);
    const newTail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.queueTailByKey.set(key, newTail);
    void newTail.finally(() => {
      if (this.queueTailByKey.get(key) === newTail) this.queueTailByKey.delete(key);
    });
    return operation;
  }
}
