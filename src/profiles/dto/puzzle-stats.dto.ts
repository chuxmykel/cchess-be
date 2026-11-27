import { ApiProperty } from '@nestjs/swagger';

import {
  RATING_STATS_PERIODS,
  type RatingStatsPeriod,
} from '../rating-stats.js';
import { PuzzleRatingSummaryDto } from './public-profile.dto.js';
import { RatingPointDto } from './rating-stats.dto.js';

export class BestSolveDto {
  @ApiProperty()
  puzzleId!: string;

  @ApiProperty({ description: "The puzzle's rating" })
  rating!: number;

  @ApiProperty()
  at!: Date;
}

export class ThemeRecordDto {
  @ApiProperty({ description: "Lichess's name for the theme" })
  theme!: string;

  @ApiProperty()
  attempts!: number;

  @ApiProperty()
  solved!: number;
}

export class PuzzleStatsDto {
  @ApiProperty({ enum: RATING_STATS_PERIODS })
  period!: RatingStatsPeriod;

  @ApiProperty({
    type: PuzzleRatingSummaryDto,
    description: 'The puzzle rating right now',
  })
  rating!: PuzzleRatingSummaryDto;

  @ApiProperty({
    type: [RatingPointDto],
    description:
      "The rating going into the period's first try, then each day's closing rating, oldest first",
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

  @ApiProperty({ description: 'Pool puzzles tried in the period' })
  attempts!: number;

  @ApiProperty()
  solved!: number;

  @ApiProperty()
  missed!: number;

  @ApiProperty({
    type: BestSolveDto,
    nullable: true,
    description: 'The highest-rated puzzle solved',
  })
  bestSolve!: BestSolveDto | null;

  @ApiProperty()
  longestSolvedStreak!: number;

  @ApiProperty()
  longestMissedStreak!: number;

  @ApiProperty({
    type: [ThemeRecordDto],
    description: 'Each theme tried, the most tried first',
  })
  themes!: ThemeRecordDto[];
}
