import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';

import { DAILY_DAYS } from '../../chess/time-control.js';
import { RatingRangeDto } from '../../matchmaking/dto/create-seek.dto.js';
import {
  SEEK_COLORS,
  type SeekColor,
} from '../../matchmaking/seek-matching.js';
import type { DailySeekRequest } from '../daily-seeks.service.js';

export class CreateDailySeekDto implements DailySeekRequest {
  @ApiProperty({ enum: DAILY_DAYS, description: 'Days per move' })
  @IsInt()
  @IsIn(DAILY_DAYS)
  days!: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Ignored for guests, whose games are always casual',
  })
  @IsOptional()
  @IsBoolean()
  rated?: boolean;

  @ApiPropertyOptional({
    type: RatingRangeDto,
    description:
      'Opponent ratings accepted, relative to your own. Omit to accept any',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RatingRangeDto)
  ratingRange?: RatingRangeDto;

  @ApiPropertyOptional({ enum: SEEK_COLORS, default: 'random' })
  @IsOptional()
  @IsIn(SEEK_COLORS)
  color?: SeekColor;
}
