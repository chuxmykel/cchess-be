import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ClusterBus } from '../cluster/cluster-bus.js';
import {
  CLUSTER_WORKERS,
  CLUSTERING_ENABLED,
  WORKER_INDEX,
} from '../cluster/cluster.util.js';
import { MAINTENANCE_RPC } from '../cluster/rpc-channels.js';
import { DOMAIN_EVENTS } from '../common/events.js';

/** What a player trying to start a live game is told during maintenance. */
export const MAINTENANCE_MESSAGE =
  'The server restarts for maintenance once the live games in progress ' +
  'finish. New live games are paused until then; daily games can still start.';

export interface MaintenanceChangedEvent {
  /** When it's set to begin, or null once it's over. */
  startsAt: Date | null;
}

/**
 * Maintenance - a deploy, a reboot - timed for when no live game is being
 * played. It's announced with a time to begin, for the app's banner, and
 * from the moment it's announced no new live game starts (no seek,
 * challenge or rematch) and the live seeks waiting are dropped, while the
 * games in progress play out. Daily games start and carry on throughout:
 * a restart loses none of them. cchess-infra's scripts/maintenance.sh
 * announces it, waits for that time and for the live games to finish -
 * however long that takes - then restarts the api.
 *
 * Kept in memory, so the restart - the point of it - ends it. Under
 * clustering every worker holds its own copy, set on all of them by the
 * worker the request reached, since any of them may create a game.
 */
@Injectable()
export class MaintenanceService {
  private startsAt: Date | null = null;

  constructor(
    private readonly clusterBus: ClusterBus,
    private readonly events: EventEmitter2,
  ) {
    this.clusterBus.onRequest(
      MAINTENANCE_RPC.SET,
      async ({ startsAt }: { startsAt: string | null }) => {
        this.setLocal(startsAt ? new Date(startsAt) : null);
        return null;
      },
    );
  }

  /** When maintenance is set to begin, or null with none announced. */
  startsAtTime(): Date | null {
    return this.startsAt;
  }

  /** Throws once maintenance is announced. */
  assertLiveGamesAllowed(): void {
    if (this.startsAt) {
      throw new ServiceUnavailableException(MAINTENANCE_MESSAGE);
    }
  }

  /** Announces maintenance `minutes` from now - or, already announced,
   * leaves it at the time it was given. */
  start(minutes: number): Promise<void> {
    return this.setEverywhere(
      this.startsAt ?? new Date(Date.now() + minutes * 60_000),
    );
  }

  /** Ends maintenance: new games may start again. */
  end(): Promise<void> {
    return this.setEverywhere(null);
  }

  private async setEverywhere(startsAt: Date | null): Promise<void> {
    const changed = this.startsAt?.getTime() !== startsAt?.getTime();
    this.setLocal(startsAt);
    if (CLUSTERING_ENABLED) {
      const others = Array.from({ length: CLUSTER_WORKERS }, (_, i) => i);
      await Promise.all(
        others
          .filter((worker) => worker !== WORKER_INDEX)
          .map((worker) =>
            this.clusterBus.request(worker, MAINTENANCE_RPC.SET, {
              startsAt: startsAt?.toISOString() ?? null,
            }),
          ),
      );
    }
    // Once, from this worker: the gateway pushes it to every socket.
    if (changed) {
      this.events.emit(DOMAIN_EVENTS.MAINTENANCE_CHANGED, {
        startsAt,
      } satisfies MaintenanceChangedEvent);
    }
  }

  private setLocal(startsAt: Date | null): void {
    const starting = !this.startsAt && startsAt;
    this.startsAt = startsAt;
    // On every worker: the matchmaker's seeks are dropped where they're kept.
    if (starting) this.events.emit(DOMAIN_EVENTS.MAINTENANCE_UNDERWAY);
  }
}
