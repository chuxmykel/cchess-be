import { ApiProperty } from '@nestjs/swagger';

import type { GameType } from '../../chess/time-control.js';
import type {
  DrawOfferBy,
  Game,
  GameResult,
  GameResultReason,
  GameStatus,
} from '../entities/game.entity.js';
import type { Move } from '../entities/move.entity.js';
import { isProvisional } from '../../users/entities/rating.entity.js';

export class GamePlayerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "The player's rating in this category when the game started; null for guests",
  })
  rating!: number | null;

  @ApiProperty({
    description:
      'Whether that rating was still uncertain (rating deviation above 110)',
  })
  provisional!: boolean;
}

export class MoveDto {
  @ApiProperty()
  ply!: number;

  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;

  @ApiProperty()
  piece!: string;

  @ApiProperty()
  color!: 'w' | 'b';

  @ApiProperty()
  san!: string;

  @ApiProperty({ nullable: true })
  captured!: string | null;

  @ApiProperty({ nullable: true })
  promotion!: string | null;

  @ApiProperty()
  fenAfter!: string;

  @ApiProperty()
  clockAfterMs!: number;
}

export class GameStateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: GamePlayerDto })
  white!: GamePlayerDto;

  @ApiProperty({ type: GamePlayerDto })
  black!: GamePlayerDto;

  @ApiProperty()
  minutes!: number;

  @ApiProperty()
  incrementSeconds!: number;

  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical'] })
  gameType!: GameType;

  @ApiProperty()
  rated!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "What a rated, completed game did to white's rating",
  })
  whiteRatingDiff!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "What a rated, completed game did to black's rating",
  })
  blackRatingDiff!: number | null;

  @ApiProperty({ enum: ['active', 'completed', 'aborted'] })
  status!: GameStatus;

  @ApiProperty({ nullable: true })
  result!: GameResult;

  @ApiProperty({ nullable: true })
  resultReason!: GameResultReason;

  @ApiProperty()
  fen!: string;

  @ApiProperty()
  turn!: 'w' | 'b';

  @ApiProperty()
  whiteTimeRemainingMs!: number;

  @ApiProperty()
  blackTimeRemainingMs!: number;

  @ApiProperty({ nullable: true })
  lastMoveAt!: Date | null;

  @ApiProperty({ nullable: true })
  drawOfferedBy!: DrawOfferBy;

  @ApiProperty({ type: [MoveDto] })
  moves!: MoveDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  endedAt!: Date | null;
}

function toPlayerDto(
  user: Game['white'],
  rating: number | null,
  deviation: number | null,
): GamePlayerDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    rating,
    provisional: isProvisional(deviation),
  };
}

export function toMoveDto(move: Move): MoveDto {
  return {
    ply: move.ply,
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
    san: move.san,
    captured: move.captured,
    promotion: move.promotion,
    fenAfter: move.fenAfter,
    clockAfterMs: move.clockAfterMs,
  };
}

export function toGameStateDto(game: Game): GameStateDto {
  return {
    id: game.id,
    white: toPlayerDto(
      game.white,
      game.whiteRatingAtStart,
      game.whiteDeviationAtStart,
    ),
    black: toPlayerDto(
      game.black,
      game.blackRatingAtStart,
      game.blackDeviationAtStart,
    ),
    minutes: game.minutes,
    incrementSeconds: game.incrementSeconds,
    gameType: game.gameType,
    rated: game.rated,
    whiteRatingDiff: game.whiteRatingDiff,
    blackRatingDiff: game.blackRatingDiff,
    status: game.status,
    result: game.result,
    resultReason: game.resultReason,
    fen: game.fen,
    turn: game.turn,
    whiteTimeRemainingMs: game.whiteTimeRemainingMs,
    blackTimeRemainingMs: game.blackTimeRemainingMs,
    lastMoveAt: game.lastMoveAt,
    drawOfferedBy: game.drawOfferedBy,
    moves: (game.moves ?? []).map(toMoveDto),
    createdAt: game.createdAt,
    endedAt: game.endedAt,
  };
}
