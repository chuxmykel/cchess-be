/**
 * Keeps track of async work nothing awaits - a push sent from an event
 * listener, say - so shutting down can wait for it before the database
 * closes under it (see RealtimeGateway.beforeApplicationShutdown). Work
 * that fails is the caller's to report; drain() only waits.
 */
export class InFlight {
  private readonly running = new Set<Promise<unknown>>();

  run<T>(work: () => Promise<T>): Promise<T> {
    const promise = work();
    this.running.add(promise);
    const forget = () => this.running.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  /** Resolves once nothing is running - work started while it waits
   * included. */
  async drain(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled(this.running);
    }
  }
}
