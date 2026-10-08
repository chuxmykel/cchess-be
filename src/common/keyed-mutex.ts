/**
 * Serializes async work per key so e.g. a move arriving at the exact instant
 * a clock's flag-fall timer fires can't both mutate the same game row at
 * once. Single-process only - fine for a single Nest instance backed by
 * SQLite; a multi-instance deployment would need a DB-level lock instead.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.finally(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return run;
  }
}
