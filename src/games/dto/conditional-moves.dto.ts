import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

import {
  MAX_CONDITIONAL_LINE_MOVES,
  MAX_CONDITIONAL_LINES,
} from '../conditional-moves.js';

export class ConditionalLinesDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "The game's move count the lines start from; null when there are none",
  })
  basePly!: number | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
    description:
      "Each line the opponent's move, your reply, theirs, yours..., in UCI",
  })
  lines!: string[][];
}

export class AddConditionalLinesDto {
  @ApiProperty({
    description:
      "The game's move count, which the lines start from - the opponent being to move",
  })
  @IsInt()
  @Min(0)
  basePly!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
    maxItems: MAX_CONDITIONAL_LINES,
    description: `Each the opponent's move, your reply, theirs, yours..., in UCI - at most ${MAX_CONDITIONAL_LINE_MOVES} moves; a last move with no reply is dropped`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_CONDITIONAL_LINES)
  // Each move is checked in ConditionalMovesService: class-validator can't
  // reach into an array of arrays.
  @IsArray({ each: true })
  lines!: string[][];
}
