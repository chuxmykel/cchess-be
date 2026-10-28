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
  MAX_INCREMENT,
  MAX_INITIAL_SECONDS,
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
    description: 'Starting clock per side, in seconds',
    minimum: MIN_INITIAL_SECONDS,
    maximum: MAX_INITIAL_SECONDS,
  })
  @IsInt()
  @Min(MIN_INITIAL_SECONDS)
  @Max(MAX_INITIAL_SECONDS)
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
