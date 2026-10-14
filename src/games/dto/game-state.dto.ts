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

export class GamePlayerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;
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

function toPlayerDto(user: Game['white']): GamePlayerDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
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
    white: toPlayerDto(game.white),
    black: toPlayerDto(game.black),
    minutes: game.minutes,
    incrementSeconds: game.incrementSeconds,
    gameType: game.gameType,
    rated: game.rated,
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
