import { ApiProperty } from '@nestjs/swagger';

import type { GameType } from '../../chess/time-control.js';
import type { Game, GameResultReason, GameStatus } from '../entities/game.entity.js';

export type PerspectiveResult = 'win' | 'loss' | 'draw' | null;

export class GameSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical'] })
  gameType!: GameType;

  @ApiProperty()
  minutes!: number;

  @ApiProperty()
  incrementSeconds!: number;

  @ApiProperty()
  rated!: boolean;

  @ApiProperty({ enum: ['active', 'completed', 'aborted'] })
  status!: GameStatus;

  @ApiProperty({ nullable: true })
  result!: PerspectiveResult;

  @ApiProperty({ nullable: true })
  resultReason!: GameResultReason;

  @ApiProperty()
  opponentUsername!: string;

  @ApiProperty()
  opponentDisplayName!: string;

  @ApiProperty()
  playedAsWhite!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  endedAt!: Date | null;
}

export function toGameSummaryDto(game: Game, viewerId: string): GameSummaryDto {
  const playedAsWhite = game.whiteId === viewerId;
  const opponent = playedAsWhite ? game.black : game.white;

  let result: PerspectiveResult = null;
  if (game.result === 'draw') result = 'draw';
  else if (game.result === 'white') result = playedAsWhite ? 'win' : 'loss';
  else if (game.result === 'black') result = playedAsWhite ? 'loss' : 'win';

  return {
    id: game.id,
    gameType: game.gameType,
    minutes: game.minutes,
    incrementSeconds: game.incrementSeconds,
    rated: game.rated,
    status: game.status,
    result,
    resultReason: game.resultReason,
    opponentUsername: opponent.username,
    opponentDisplayName: opponent.displayName,
    playedAsWhite,
    createdAt: game.createdAt,
    endedAt: game.endedAt,
  };
}
