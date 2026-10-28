import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  MAX_INCREMENT,
  MAX_INITIAL_SECONDS,
  MIN_INCREMENT,
  MIN_INITIAL_SECONDS,
} from '../../chess/time-control.js';
import {
  MAX_RATING_RANGE_DELTA,
  type RatingRange,
  type SeekRequest,
} from '../seek-matching.js';

export class RatingRangeDto implements RatingRange {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_RATING_RANGE_DELTA,
    nullable: true,
    description: 'Null or omitted for no lower limit',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RATING_RANGE_DELTA)
  below!: number | null;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_RATING_RANGE_DELTA,
    nullable: true,
    description: 'Null or omitted for no upper limit',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RATING_RANGE_DELTA)
  above!: number | null;
}

export class CreateSeekDto implements SeekRequest {
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
}
