import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { RatingDto } from '../../users/dto/profile.dto.js';
import {
  RATING_STATS_PERIODS,
  type RatingStatsPeriod,
} from '../rating-stats.js';
import { ScoreDto } from './public-profile.dto.js';

export const DEFAULT_RATING_STATS_PERIOD: RatingStatsPeriod = '1m';

export class RatingStatsQuery {
  @ApiProperty({
    enum: RATING_STATS_PERIODS,
    required: false,
    default: DEFAULT_RATING_STATS_PERIOD,
  })
  @IsOptional()
  @IsIn(RATING_STATS_PERIODS)
  period?: RatingStatsPeriod;
}

export class RatingPointDto {
  @ApiProperty()
  at!: Date;

  @ApiProperty()
  rating!: number;
}

export class NotableGameDto {
  @ApiProperty()
  gameId!: string;

  @ApiProperty()
  opponentUsername!: string;

  @ApiProperty()
  opponentDisplayName!: string;

  @ApiProperty({ description: "The opponent's rating when the game started" })
  opponentRating!: number;

  @ApiProperty()
  endedAt!: Date;
}

export class RatingStatsDto extends ScoreDto {
  @ApiProperty({ enum: RATING_STATS_PERIODS })
  period!: RatingStatsPeriod;

  @ApiProperty({ type: RatingDto, description: 'The rating right now' })
  rating!: RatingDto;

  @ApiProperty({
    type: [RatingPointDto],
    description:
      "The rating going into the period's first rated game, then after each rated game, oldest first",
  })
  history!: RatingPointDto[];

  @ApiProperty({ type: RatingPointDto, nullable: true })
  highest!: RatingPointDto | null;

  @ApiProperty({ type: RatingPointDto, nullable: true })
  lowest!: RatingPointDto | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Points gained over the period, negative when lost',
  })
  ratingChange!: number | null;

  @ApiProperty({ description: 'Finished games, rated and casual' })
  games!: number;

  @ApiProperty()
  timePlayedMs!: number;

  @ApiProperty({
    type: NotableGameDto,
    nullable: true,
    description: 'The rated win over the highest-rated opponent',
  })
  bestWin!: NotableGameDto | null;

  @ApiProperty({
    type: NotableGameDto,
    nullable: true,
    description: 'The rated loss to the lowest-rated opponent',
  })
  worstLoss!: NotableGameDto | null;

  @ApiProperty()
  longestWinStreak!: number;

  @ApiProperty()
  longestLosingStreak!: number;
}
