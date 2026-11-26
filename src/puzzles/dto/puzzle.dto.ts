import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { PersonalPuzzle } from '../entities/personal-puzzle.entity.js';
import type { Puzzle } from '../entities/puzzle.entity.js';

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const THEME = /^[a-zA-Z0-9]{1,32}$/;

/** The most a personal puzzle's line runs to: three of the solver's moves. */
export const MAX_SOLUTION_MOVES = 5;

export class NextPuzzleQuery {
  @ApiPropertyOptional({ description: "A lichess theme, e.g. 'fork'" })
  @IsOptional()
  @Matches(THEME)
  theme?: string;
}

export class PuzzleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "The position before the opponent's move" })
  fen!: string;

  @ApiProperty({
    type: [String],
    description: "UCI: the opponent's move, then the solution",
  })
  moves!: string[];

  @ApiProperty()
  rating!: number;

  @ApiProperty({ type: [String] })
  themes!: string[];
}

export function toPuzzleDto(puzzle: Puzzle): PuzzleDto {
  return {
    id: puzzle.id,
    fen: puzzle.fen,
    moves: puzzle.moves.split(' '),
    rating: puzzle.rating,
    themes: puzzle.themes,
  };
}

export class PuzzleAttemptDto {
  @ApiProperty()
  @IsBoolean()
  solved!: boolean;
}

export class PuzzleRatingDto {
  @ApiProperty()
  rating!: number;

  @ApiProperty()
  deviation!: number;

  @ApiProperty({ description: 'Pool puzzles tried' })
  attempts!: number;
}

export class PuzzleAttemptResultDto {
  @ApiProperty()
  ratingBefore!: number;

  @ApiProperty()
  ratingAfter!: number;
}

export class NewPersonalPuzzleDto {
  @ApiProperty({ description: "The move missed: 1 for white's first" })
  @IsInt()
  @Min(1)
  @Max(2000)
  ply!: number;

  @ApiProperty({ description: 'The position before it, the solver to move' })
  @IsString()
  @Length(10, 100)
  fen!: string;

  @ApiProperty({ type: [String], description: 'The winning line, in UCI' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SOLUTION_MOVES)
  @Matches(UCI, { each: true })
  solution!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(THEME, { each: true })
  themes!: string[];
}

export class AddPersonalPuzzlesDto {
  @ApiProperty()
  @IsUUID()
  gameId!: string;

  @ApiProperty({ type: [NewPersonalPuzzleDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NewPersonalPuzzleDto)
  puzzles!: NewPersonalPuzzleDto[];
}

export class PersonalPuzzleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  gameId!: string;

  @ApiProperty()
  ply!: number;

  @ApiProperty({ description: 'The position to solve, the solver to move' })
  fen!: string;

  @ApiProperty({ type: [String] })
  solution!: string[];

  @ApiProperty({ type: [String] })
  themes!: string[];

  @ApiProperty()
  dueAt!: Date;

  @ApiProperty()
  step!: number;
}

export function toPersonalPuzzleDto(puzzle: PersonalPuzzle): PersonalPuzzleDto {
  return {
    id: puzzle.id,
    gameId: puzzle.gameId,
    ply: puzzle.ply,
    fen: puzzle.fen,
    solution: puzzle.solution,
    themes: puzzle.themes,
    dueAt: puzzle.dueAt,
    step: puzzle.step,
  };
}

export class PersonalPuzzlesDto {
  @ApiProperty({
    type: [PersonalPuzzleDto],
    description: 'Those due now, the longest waiting first',
  })
  due!: PersonalPuzzleDto[];

  @ApiProperty({ description: 'How many are due now' })
  dueCount!: number;

  @ApiProperty({ description: 'Being learnt, not due yet' })
  learning!: number;

  @ApiProperty({ description: 'Learnt: found at the last step' })
  mastered!: number;
}
