import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import type { GameStatus } from '../entities/game.entity.js';

const STATUSES: GameStatus[] = ['active', 'completed', 'aborted'];

export class ListGamesQuery {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: GameStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'ISO date - only games created before this' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}
