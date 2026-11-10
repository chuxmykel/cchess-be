import { describe, expect, it } from 'vitest';

import { InFlight } from './in-flight.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('InFlight', () => {
  it('passes the work’s own result through', async () => {
    await expect(new InFlight().run(async () => 42)).resolves.toBe(42);
  });

  it('drains at once with nothing running', async () => {
    await expect(new InFlight().drain()).resolves.toBeUndefined();
  });

  it('waits for the work running, and work started meanwhile', async () => {
    const inFlight = new InFlight();
    const done: string[] = [];
    const slow = deferred();
    void inFlight.run(async () => {
      await slow.promise;
      done.push('push');
      void inFlight.run(async () => {
        done.push('follow-up');
      });
    });

    let drained = false;
    const draining = inFlight.drain().then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);

    slow.resolve();
    await draining;
    expect(done).toEqual(['push', 'follow-up']);
  });

  it('carries on past work that failed', async () => {
    const inFlight = new InFlight();
    const failed = inFlight.run(async () => {
      throw new Error('boom');
    });

    await inFlight.drain();
    await expect(failed).rejects.toThrow('boom');
  });
});
