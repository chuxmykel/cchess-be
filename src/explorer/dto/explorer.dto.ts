import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  LICHESS_RATINGS,
  LICHESS_SPEEDS,
  type LichessRating,
  type LichessSpeed,
} from '../lichess/lichess-explorer.client.js';

export const EXPLORER_DBS = ['masters', 'lichess', 'player'] as const;
export type ExplorerDb = (typeof EXPLORER_DBS)[number];

export const EXPLORER_SOURCES = [
  'masters',
  'lichess',
  'player',
  'cchess',
] as const;
/** Where an answer came from: a database asked for, or - lichess out of
 * reach, or none asked for - the games played here. */
export type ExplorerSource = (typeof EXPLORER_SOURCES)[number];

/** `a,b` - or `a&...=b`, or either after implicit conversion - as a list. */
function commaList({ value }: TransformFnParams): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return [value]
    .flat()
    .flatMap((item: unknown) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export class ExplorerQuery {
  @ApiProperty({ description: 'The position, as a FEN' })
  @IsString()
  @MaxLength(100)
  fen!: string;

  @ApiPropertyOptional({
    enum: EXPLORER_DBS,
    description: 'Left out: the games played here',
  })
  @IsOptional()
  @IsIn(EXPLORER_DBS)
  db?: ExplorerDb;

  @ApiPropertyOptional({
    description: `The Lichess database's speeds, comma-separated: ${LICHESS_SPEEDS.join(', ')}. Left out: blitz, rapid, classical`,
  })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(LICHESS_SPEEDS, { each: true })
  speeds?: LichessSpeed[];

  @ApiPropertyOptional({
    description: `The Lichess database's rating bands, comma-separated: ${LICHESS_RATINGS.join(', ')}. Left out: 1600 and up`,
  })
  @IsOptional()
  @Transform((params) => commaList(params)?.map(Number))
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(LICHESS_RATINGS, { each: true })
  ratings?: LichessRating[];

  @ApiPropertyOptional({
    description: "The player whose games the Player database is - db=player's",
  })
  @ValidateIf((query: ExplorerQuery) => query.db === 'player')
  @IsUUID()
  user?: string;

  @ApiPropertyOptional({
    enum: ['white', 'black'],
    default: 'white',
    description: 'The side the player played',
  })
  @IsOptional()
  @IsIn(['white', 'black'])
  color?: 'white' | 'black';
}

export class ExplorerMoveDto {
  @ApiProperty()
  san!: string;

  @ApiProperty({ example: 'e2e4' })
  uci!: string;

  @ApiProperty({ description: 'Games in which it was played here' })
  games!: number;

  @ApiProperty()
  whiteWins!: number;

  @ApiProperty()
  draws!: number;

  @ApiProperty()
  blackWins!: number;
}

export class ExplorerPositionDto {
  @ApiProperty({
    enum: EXPLORER_SOURCES,
    description:
      'Where the answer came from - "cchess", the games played here, when lichess was asked but out of reach',
  })
  source!: ExplorerSource;

  @ApiProperty({
    description:
      "Lichess's answer as kept over 30 days ago; a fresh one is on its way",
  })
  stale!: boolean;

  @ApiProperty({ description: 'Games that reached the position and went on' })
  totalGames!: number;

  @ApiProperty()
  whiteWins!: number;

  @ApiProperty()
  draws!: number;

  @ApiProperty()
  blackWins!: number;

  @ApiProperty({
    type: [ExplorerMoveDto],
    description: 'The moves played from it, the most played first',
  })
  moves!: ExplorerMoveDto[];
}
