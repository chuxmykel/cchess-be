import { ApiProperty } from '@nestjs/swagger';

import { SECONDS_PER_DAY } from '../../chess/time-control.js';
import { GameStateDto } from '../../games/dto/game-state.dto.js';
import { RatingRangeDto } from '../../matchmaking/dto/create-seek.dto.js';
import {
  SEEK_COLORS,
  type SeekColor,
} from '../../matchmaking/seek-matching.js';
import type { DailySeek } from '../entities/daily-seek.entity.js';

export class DailySeekDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Days per move' })
  days!: number;

  @ApiProperty()
  rated!: boolean;

  @ApiProperty({ type: RatingRangeDto, nullable: true })
  ratingRange!: RatingRangeDto | null;

  @ApiProperty({ enum: SEEK_COLORS })
  color!: SeekColor;

  @ApiProperty()
  createdAt!: Date;
}

export class DailySeekResultDto {
  @ApiProperty({ enum: ['queued', 'matched'] })
  status!: 'queued' | 'matched';

  @ApiProperty({
    type: DailySeekDto,
    required: false,
    description: 'Queued: the seek, waiting',
  })
  seek?: DailySeekDto;

  @ApiProperty({
    type: GameStateDto,
    required: false,
    description: 'Matched: the game it started',
  })
  game?: GameStateDto;
}

export function toDailySeekDto(seek: DailySeek): DailySeekDto {
  return {
    id: seek.id,
    days: seek.initialSeconds / SECONDS_PER_DAY,
    rated: seek.rated,
    ratingRange:
      seek.ratingBelow === null && seek.ratingAbove === null
        ? null
        : { below: seek.ratingBelow, above: seek.ratingAbove },
    color: seek.color,
    createdAt: seek.createdAt,
  };
}
