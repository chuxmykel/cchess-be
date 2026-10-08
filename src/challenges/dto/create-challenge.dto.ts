import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import type { ColorPreference } from '../entities/challenge.entity.js';

const COLOR_PREFERENCES: ColorPreference[] = ['white', 'black', 'random'];

export class CreateChallengeDto {
  @ApiProperty()
  @IsString()
  opponentUsername!: string;

  @ApiProperty({ minimum: 0, maximum: 180 })
  @IsInt()
  @Min(0)
  @Max(180)
  minutes!: number;

  @ApiProperty({ minimum: 0, maximum: 180 })
  @IsInt()
  @Min(0)
  @Max(180)
  incrementSeconds!: number;

  @ApiPropertyOptional({ enum: COLOR_PREFERENCES, default: 'random' })
  @IsOptional()
  @IsIn(COLOR_PREFERENCES)
  color?: ColorPreference;
}
