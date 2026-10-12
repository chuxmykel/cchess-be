import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import type { GameStatus } from '../entities/game.entity.js';

const STATUSES: GameStatus[] = ['active', 'completed', 'aborted'];

// Exported so GamesService.listGamesForUser enforces the same bounds this
// DTO validates at the API boundary, instead of a second, separately
// maintained "20 default, 50 max" at the service layer.
export const DEFAULT_GAMES_LIST_LIMIT = 20;
export const MAX_GAMES_LIST_LIMIT = 50;
const MIN_GAMES_LIST_LIMIT = 1;

export class ListGamesQuery {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: GameStatus;

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

  @ApiPropertyOptional({ description: 'ISO date - only games created before this' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}
