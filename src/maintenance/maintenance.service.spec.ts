import { ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClusterBus } from '../cluster/cluster-bus.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { MaintenanceService } from './maintenance.service.js';

function makeService() {
  const events = new EventEmitter2();
  const clusterBus = { onRequest: vi.fn(), request: vi.fn() };
  const service = new MaintenanceService(
    clusterBus as unknown as ClusterBus,
    events,
  );
  return { service, events };
}

describe('MaintenanceService', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('allows new live games with no maintenance', () => {
    const { service } = makeService();
    expect(service.startsAtTime()).toBeNull();
    expect(() => service.assertLiveGamesAllowed()).not.toThrow();
  });

  it('refuses new live games from the moment it is announced, before it begins', async () => {
    const { service } = makeService();
    await service.start(5);
    expect(service.startsAtTime()).toEqual(new Date('2026-11-17T12:05:00Z'));
    expect(() => service.assertLiveGamesAllowed()).toThrow(
      ServiceUnavailableException,
    );
  });

  it('keeps the time it was given when announced again', async () => {
    const { service } = makeService();
    await service.start(5);
    vi.advanceTimersByTime(60_000);
    await service.start(10);
    expect(service.startsAtTime()).toEqual(new Date('2026-11-17T12:05:00Z'));
  });

  it('allows new live games again once ended', async () => {
    const { service } = makeService();
    await service.start(0);
    await service.end();
    expect(service.startsAtTime()).toBeNull();
    expect(() => service.assertLiveGamesAllowed()).not.toThrow();
  });

  it('announces each change once, and drops the seeks once as it starts', async () => {
    const { service, events } = makeService();
    const changed = vi.fn();
    const underway = vi.fn();
    events.on(DOMAIN_EVENTS.MAINTENANCE_CHANGED, changed);
    events.on(DOMAIN_EVENTS.MAINTENANCE_UNDERWAY, underway);

    await service.start(0);
    await service.start(0);
    await service.end();

    expect(changed.mock.calls).toEqual([
      [{ startsAt: new Date('2026-11-17T12:00:00Z') }],
      [{ startsAt: null }],
    ]);
    expect(underway).toHaveBeenCalledTimes(1);
  });
});
