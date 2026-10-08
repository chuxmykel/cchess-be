import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { classifyTimeControl, isValidTimeControl, type GameType, type TimeControl } from '../chess/time-control.js';
import { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/entities/user.entity.js';

interface Seek {
  userId: string;
  user: User;
  minutes: number;
  incrementSeconds: number;
  gameType: GameType;
  rating: number;
  createdAt: number;
}

export interface MatchmakingMatchedEvent {
  game: Game;
}

export type SeekResult = { status: 'queued' } | { status: 'matched'; game: Game };

/**
 * In-memory seek pool: pairs up players wanting the same time control.
 * Single-process only (fine for one Nest instance / SQLite); a
 * multi-instance deployment would need this moved to a shared store (e.g.
 * Redis) so seeks are visible across processes.
 */
@Injectable()
export class MatchmakingService {
  private readonly seeksByUser = new Map<string, Seek>();

  constructor(
    private readonly gamesService: GamesService,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
  ) {}

  async seek(user: User, tc: TimeControl): Promise<SeekResult> {
    if (!isValidTimeControl(tc)) {
      throw new BadRequestException('Invalid time control');
    }
    if (this.seeksByUser.has(user.id)) {
      throw new ConflictException('Already in the matchmaking queue - cancel it first');
    }

    const gameType = classifyTimeControl(tc);
    const rating = (await this.usersService.getOrCreateRating(user.id, gameType)).rating;

    const opponentSeek = this.findCompatibleSeek(user.id, tc, rating);
    if (!opponentSeek) {
      this.seeksByUser.set(user.id, {
        userId: user.id,
        user,
        minutes: tc.minutes,
        incrementSeconds: tc.incrementSeconds,
        gameType,
        rating,
        createdAt: Date.now(),
      });
      return { status: 'queued' };
    }

    this.seeksByUser.delete(opponentSeek.userId);

    const whiteFirst = Math.random() < 0.5;
    const white = whiteFirst ? user : opponentSeek.user;
    const black = whiteFirst ? opponentSeek.user : user;

    const game = await this.gamesService.createGame(white, black, tc, true);
    this.events.emit('matchmaking.matched', { game } satisfies MatchmakingMatchedEvent);
    return { status: 'matched', game };
  }

  cancelSeek(userId: string): void {
    this.seeksByUser.delete(userId);
  }

  getStatus(userId: string): { seeking: boolean; minutes?: number; incrementSeconds?: number } {
    const seek = this.seeksByUser.get(userId);
    if (!seek) return { seeking: false };
    return { seeking: true, minutes: seek.minutes, incrementSeconds: seek.incrementSeconds };
  }

  private findCompatibleSeek(userId: string, tc: TimeControl, rating: number): Seek | undefined {
    const RATING_WINDOW = 400;
    let best: Seek | undefined;
    let bestDiff = Infinity;

    for (const seek of this.seeksByUser.values()) {
      if (seek.userId === userId) continue;
      if (seek.minutes !== tc.minutes || seek.incrementSeconds !== tc.incrementSeconds) continue;
      const diff = Math.abs(seek.rating - rating);
      if (diff > RATING_WINDOW) continue;
      if (diff < bestDiff) {
        best = seek;
        bestDiff = diff;
      }
    }
    return best;
  }
}
