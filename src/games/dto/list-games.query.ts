import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import type { GameType } from '../../chess/time-control.js';
import { GAME_TYPES } from '../../users/users.service.js';
import type { GameStatus } from '../entities/game.entity.js';

const STATUSES: GameStatus[] = ['active', 'completed', 'aborted'];

/** Live games, or daily ones (see time-control.ts's DAILY_DAYS). */
export type GameKind = 'live' | 'daily';
const KINDS: GameKind[] = ['live', 'daily'];

/** How a game ended for the player whose games they are. */
export type GameOutcome = 'win' | 'draw' | 'loss';
const OUTCOMES: GameOutcome[] = ['win', 'draw', 'loss'];

// Exported so GamesService.listGamesForUser enforces the same bounds this
// DTO validates at the API boundary, instead of a second, separately
// maintained "10 default, 50 max" at the service layer.
export const DEFAULT_GAMES_LIST_LIMIT = 10;
export const MAX_GAMES_LIST_LIMIT = 50;
const MIN_GAMES_LIST_LIMIT = 1;

export class ListGamesQuery {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: GameStatus;

  @ApiPropertyOptional({ enum: KINDS, description: 'Omit for both' })
  @IsOptional()
  @IsIn(KINDS)
  kind?: GameKind;

  @ApiPropertyOptional({
    enum: OUTCOMES,
    description: 'Only games ending so for the player whose games they are',
  })
  @IsOptional()
  @IsIn(OUTCOMES)
  result?: GameOutcome;

  @ApiPropertyOptional({ enum: GAME_TYPES })
  @IsOptional()
  @IsIn(GAME_TYPES)
  gameType?: GameType;

  @ApiPropertyOptional({
    minimum: MIN_GAMES_LIST_LIMIT,
    maximum: MAX_GAMES_LIST_LIMIT,
    default: DEFAULT_GAMES_LIST_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_GAMES_LIST_LIMIT)
  @Max(MAX_GAMES_LIST_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description: 'ISO date - only games created before this',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}
