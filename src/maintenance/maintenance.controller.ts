import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { Public } from '../common/decorators/public.decorator.js';
import { StartMaintenanceDto } from './dto/start-maintenance.dto.js';
import { Game } from '../games/entities/game.entity.js';
import { LoopbackOnlyGuard } from './loopback-only.guard.js';
import { MaintenanceService } from './maintenance.service.js';

@ApiTags('maintenance')
@Controller()
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    @InjectRepository(Game) private readonly games: Repository<Game>,
  ) {}

  /** Maintenance announced, for the app's banner - also pushed as
   * `server:maintenance`. */
  @Public()
  @Get('maintenance')
  @ApiOkResponse({
    description:
      'When announced maintenance is set to begin (ISO 8601) - no new live game starts until it ends - or null with none announced',
  })
  status() {
    return { startsAt: this.maintenance.startsAtTime()?.toISOString() ?? null };
  }

  // The rest is for cchess-infra's scripts/maintenance.sh, run on the
  // server itself: refused to anyone else, and left out of the API docs.

  /** Maintenance announced, how long until it's set to begin, and how
   * many live games are still on: the restart may come once both are 0. */
  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Get('internal/maintenance')
  @ApiExcludeEndpoint()
  async internalStatus() {
    const liveGames = await this.games.count({
      where: { status: 'active', gameType: Not('daily') },
    });
    const startsAt = this.maintenance.startsAtTime();
    const secondsToStart = startsAt
      ? Math.max(0, Math.ceil((startsAt.getTime() - Date.now()) / 1000))
      : null;
    return { ...this.status(), secondsToStart, liveGames };
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Put('internal/maintenance')
  @ApiExcludeEndpoint()
  async start(@Body() dto: StartMaintenanceDto) {
    await this.maintenance.start(dto.minutes ?? 0);
    return this.internalStatus();
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Delete('internal/maintenance')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  async end(): Promise<void> {
    await this.maintenance.end();
  }
}
