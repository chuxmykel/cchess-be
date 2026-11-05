import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { daysPerMove } from '../../chess/time-control.js';
import { MAX_ACTIVE_DAILY_GAMES } from '../daily.js';
import type { DailyGameListing } from '../games.service.js';

export class DailyGameOpponentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;
}

export class LastMoveDto {
  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;
}

/** A daily game in progress, as a player's list of them shows it: enough
 * to draw its board and say whose move it is, and how long is left. */
export class DailyGameDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fen!: string;

  @ApiProperty({ enum: ['w', 'b'] })
  turn!: 'w' | 'b';

  @ApiProperty({ type: LastMoveDto, nullable: true })
  lastMove!: LastMoveDto | null;

  @ApiProperty()
  playedAsWhite!: boolean;

  @ApiProperty({ description: "Whether it's your move" })
  myTurn!: boolean;

  @ApiProperty()
  daysPerMove!: number;

  @ApiProperty({ description: 'When the side to move runs out of time' })
  moveDeadlineAt!: Date;

  @ApiProperty()
  rated!: boolean;

  @ApiProperty({ type: DailyGameOpponentDto })
  opponent!: DailyGameOpponentDto;
}

export class ListDailyGamesQuery {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_ACTIVE_DAILY_GAMES,
    default: MAX_ACTIVE_DAILY_GAMES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACTIVE_DAILY_GAMES)
  limit?: number;
}

export function toDailyGameDto(
  { game, lastMove, deadline, myTurn }: DailyGameListing,
  userId: string,
): DailyGameDto {
  const playedAsWhite = game.whiteId === userId;
  const opponent = playedAsWhite ? game.black : game.white;
  return {
    id: game.id,
    fen: game.fen,
    turn: game.turn,
    lastMove,
    playedAsWhite,
    myTurn,
    daysPerMove: daysPerMove(game),
    moveDeadlineAt: deadline,
    rated: game.rated,
    opponent: {
      id: opponent.id,
      username: opponent.username,
      displayName: opponent.displayName,
      avatarColor: opponent.avatarColor,
    },
  };
}
