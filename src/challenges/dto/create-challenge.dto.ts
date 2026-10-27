import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import {
  MAX_INCREMENT,
  MAX_MINUTES,
  MIN_INCREMENT,
  MIN_MINUTES,
} from '../../chess/time-control.js';
import type { ColorPreference } from '../entities/challenge.entity.js';

const COLOR_PREFERENCES: ColorPreference[] = ['white', 'black', 'random'];

export class CreateChallengeDto {
  @ApiProperty()
  @IsString()
  opponentUsername!: string;

  @ApiProperty({ minimum: MIN_MINUTES, maximum: MAX_MINUTES })
  @IsNumber()
  @Min(MIN_MINUTES)
  @Max(MAX_MINUTES)
  minutes!: number;

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
