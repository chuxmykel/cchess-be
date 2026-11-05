import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import { GamesService } from './games.service.js';

/** How often daily games are checked for a move out of time - a minute
 * late, on days a move, is nothing. */
export const DAILY_SWEEP_INTERVAL_MS = 60_000;

/**
 * Ends daily games whose side to move ran out of time: on boot, for any
 * that ran out while the server was down, and every minute after. Every
 * worker runs one, each for the games it owns (see expireOverdueDailyGames).
 * A live game's flag falls by its own timer instead; a daily game's would
 * be days away and lost to any restart in between.
 */
@Injectable()
export class DailyDeadlineSweeper
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DailyDeadlineSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly gamesService: GamesService) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, DAILY_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const ended = await this.gamesService.expireOverdueDailyGames();
      if (ended > 0) this.logger.debug(`ended ${ended} daily game(s) on time`);
    } catch (error) {
      this.logger.warn(`daily sweep failed: ${(error as Error).message}`);
    }
  }
}
