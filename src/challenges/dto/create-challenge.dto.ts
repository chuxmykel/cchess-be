import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import {
  MAX_DAILY_SECONDS,
  MAX_INCREMENT,
  MIN_INCREMENT,
  MIN_INITIAL_SECONDS,
} from '../../chess/time-control.js';
import type { ColorPreference } from '../entities/challenge.entity.js';

const COLOR_PREFERENCES: ColorPreference[] = ['white', 'black', 'random'];

export class CreateChallengeDto {
  @ApiProperty()
  @IsString()
  opponentUsername!: string;

  @ApiProperty({
    description:
      "Starting clock per side, in seconds - up to 3 hours, or a daily game's days per move in whole days (1, 2, 3, 5, 7 or 14, with no increment)",
    minimum: MIN_INITIAL_SECONDS,
    maximum: MAX_DAILY_SECONDS,
  })
  @IsInt()
  @Min(MIN_INITIAL_SECONDS)
  @Max(MAX_DAILY_SECONDS)
  initialSeconds!: number;

  @ApiProperty({ minimum: MIN_INCREMENT, maximum: MAX_INCREMENT })
  @IsInt()
  @Min(MIN_INCREMENT)
  @Max(MAX_INCREMENT)
  incrementSeconds!: number;

  @ApiPropertyOptional({ enum: COLOR_PREFERENCES, default: 'random' })
  @IsOptional()
  @IsIn(COLOR_PREFERENCES)
  color?: ColorPreference;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  rated?: boolean;
}
