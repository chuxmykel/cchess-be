import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type { GameReview } from '../entities/game-review.entity.js';

/** The longest best line kept for a position. */
export const MAX_REVIEW_LINE_MOVES = 16;
/** The deepest search a review can claim. */
export const MAX_REVIEW_DEPTH = 99;

export class ReviewScoreDto {
  @ApiProperty({ enum: ['cp', 'mate'] })
  @IsIn(['cp', 'mate'])
  kind!: 'cp' | 'mate';

  @ApiProperty({
    required: false,
    description: "Centipawns from white's side, for kind 'cp'",
  })
  @ValidateIf((score: ReviewScoreDto) => score.kind === 'cp')
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  cp?: number;

  @ApiProperty({
    required: false,
    description: "Moves to mate - 0 once it's mate - for kind 'mate'",
  })
  @ValidateIf((score: ReviewScoreDto) => score.kind === 'mate')
  @IsInt()
  @Min(0)
  @Max(500)
  moves?: number;

  @ApiProperty({
    required: false,
    enum: ['w', 'b'],
    description: "The side giving mate, for kind 'mate'",
  })
  @ValidateIf((score: ReviewScoreDto) => score.kind === 'mate')
  @IsIn(['w', 'b'])
  winner?: 'w' | 'b';
}

export class PositionEvalDto {
  @ApiProperty({ type: ReviewScoreDto })
  @ValidateNested()
  @Type(() => ReviewScoreDto)
  score!: ReviewScoreDto;

  @ApiProperty({
    type: [String],
    maxItems: MAX_REVIEW_LINE_MOVES,
    description: "The best line, in UCI; [] once the game's over",
  })
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_LINE_MOVES)
  @Matches(/^[a-h][1-8][a-h][1-8][qrbn]?$/, { each: true })
  pv!: string[];

  @ApiProperty({ type: ReviewScoreDto, nullable: true })
  @ValidateIf((positionEval: PositionEvalDto) => positionEval.second !== null)
  @ValidateNested()
  @Type(() => ReviewScoreDto)
  second!: ReviewScoreDto | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_REVIEW_DEPTH)
  depth!: number;
}

export class SaveGameReviewDto {
  @ApiProperty({ example: 'stockfish-19.0.1-lite-single' })
  @IsString()
  @Length(1, 64)
  engine!: string;

  @ApiProperty({
    description: 'The shallowest depth any position was searched to',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_REVIEW_DEPTH)
  depth!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  whiteAccuracy!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  blackAccuracy!: number;

  @ApiProperty({
    type: [PositionEvalDto],
    description:
      "Every position's eval, the start first - one more than the game's moves",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PositionEvalDto)
  evals!: PositionEvalDto[];

  @ApiProperty({
    required: false,
    description:
      "Each side's review boiled down ({ w, b }), for patterns and badges",
  })
  @IsOptional()
  @IsObject()
  digests?: Record<string, unknown>;
}

export class SaveReviewDigestsDto {
  @ApiProperty({ description: "Each side's review boiled down ({ w, b })" })
  @IsObject()
  digests!: Record<string, unknown>;
}

export class GameReviewDto {
  @ApiProperty()
  gameId!: string;

  @ApiProperty()
  engine!: string;

  @ApiProperty()
  depth!: number;

  @ApiProperty()
  whiteAccuracy!: number;

  @ApiProperty()
  blackAccuracy!: number;

  @ApiProperty({ type: [PositionEvalDto] })
  evals!: PositionEvalDto[];

  @ApiProperty({
    nullable: true,
    description:
      "Each side's review boiled down ({ w, b }) - none until sent, so the app knows to",
  })
  digests!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;
}

export function toGameReviewDto(review: GameReview): GameReviewDto {
  return {
    gameId: review.gameId,
    engine: review.engine,
    depth: review.depth,
    whiteAccuracy: review.whiteAccuracy,
    blackAccuracy: review.blackAccuracy,
    evals: review.evals,
    digests: review.digests,
    createdAt: review.createdAt,
  };
}
