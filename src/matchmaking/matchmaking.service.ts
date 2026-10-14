import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import {
  classifyTimeControl,
  isValidTimeControl,
  type GameType,
  type TimeControl,
} from '../chess/time-control.js';
import { ClusterBus } from '../cluster/cluster-bus.js';
import { CLUSTERING_ENABLED, WORKER_INDEX } from '../cluster/cluster.util.js';
import { fromWireGame, toWireGame } from '../cluster/cluster-wire.js';
import { MM_RPC } from '../cluster/rpc-channels.js';
import { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import { UsersService } from '../users/users.service.js';
import { STARTING_RATING } from '../users/entities/rating.entity.js';
import type { User } from '../users/entities/user.entity.js';

/** The handful of `User` fields `seekLocal`/`createGame` actually read, sent
 * over `ClusterBus` instead of a full `User` row (password hash included)
 * when a seek is forwarded to the matchmaker worker - see below. */
interface WireSeekUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  isGuest: boolean;
}

function toWireSeekUser(user: User): WireSeekUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    isGuest: user.isGuest,
  };
}

interface Seek {
  userId: string;
  user: User;
  minutes: number;
  incrementSeconds: number;
  gameType: GameType;
  rating: number;
  createdAt: number;
}

export type SeekResult =
  { status: 'queued' } | { status: 'matched'; game: Game };

type WireSeekResult =
  { status: 'queued' } | { status: 'matched'; game: Record<string, unknown> };

type SeekStatus = {
  seeking: boolean;
  minutes?: number;
  incrementSeconds?: number;
};

/**
 * In-memory seek pool: pairs up players wanting the same time control.
 * Single-process by default (fine for one Nest instance / SQLite). Under
 * clustering (see src/cluster/) it's pinned to worker 0 instead of made
 * fully distributed - every other worker forwards `seek`/`cancelSeek`/
 * `getStatus` there via `ClusterBus` rather than keeping its own pool, so
 * there's exactly one queue to search regardless of how many workers are
 * running. Matching is cheap and infrequent compared to per-move traffic,
 * so centralizing it on one worker isn't the bottleneck clustering is
 * solving for - see the games.service.ts ownership routing for that.
 */
@Injectable()
export class MatchmakingService {
  private readonly seeksByUser = new Map<string, Seek>();
  private static readonly MATCHMAKER_WORKER = 0;

  constructor(
    private readonly gamesService: GamesService,
    private readonly usersService: UsersService,
    private readonly clusterBus: ClusterBus,
  ) {
    this.clusterBus.onRequest(MM_RPC.SEEK, this.handleSeekRequest.bind(this));
    this.clusterBus.onRequest(
      MM_RPC.CANCEL,
      this.handleCancelRequest.bind(this),
    );
    this.clusterBus.onRequest(
      MM_RPC.STATUS,
      this.handleStatusRequest.bind(this),
    );
  }

  private async handleSeekRequest(payload: {
    user: WireSeekUser;
    tc: TimeControl;
  }) {
    const result = await this.seekLocal(
      payload.user as unknown as User,
      payload.tc,
    );
    return result.status === 'matched'
      ? { status: 'matched', game: toWireGame(result.game) }
      : result;
  }

  private async handleCancelRequest(payload: { userId: string }) {
    this.seeksByUser.delete(payload.userId);
    return null;
  }

  private async handleStatusRequest(payload: { userId: string }) {
    return this.getStatusLocal(payload.userId);
  }

  private get isMatchmaker(): boolean {
    return (
      !CLUSTERING_ENABLED ||
      WORKER_INDEX === MatchmakingService.MATCHMAKER_WORKER
    );
  }

  /**
   * Routes a matchmaking operation to wherever it actually needs to run:
   * locally if this worker is the matchmaker (see `isMatchmaker`), or
   * forwarded to it over `ClusterBus` otherwise. Mirrors
   * `GamesService.runOwnershipRouted`, just keyed on a fixed worker
   * (`MATCHMAKER_WORKER`) instead of a per-gameId owner.
   */
  private async runMatchmakerRouted<TResult, TWire = TResult>(
    channel: string,
    payload: unknown,
    fromWire: (wire: TWire) => TResult,
    runLocal: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    if (this.isMatchmaker) return runLocal();
    const wire = await this.clusterBus.request<TWire>(
      MatchmakingService.MATCHMAKER_WORKER,
      channel,
      payload,
    );
    return fromWire(wire);
  }

  private seekResultFromWire(wire: WireSeekResult): SeekResult {
    return wire.status === 'matched'
      ? { status: 'matched', game: fromWireGame(wire.game) }
      : wire;
  }

  private statusFromWire(wire: SeekStatus): SeekStatus {
    return wire;
  }

  private wireToVoid(): undefined {
    return undefined;
  }

  async seek(user: User, tc: TimeControl): Promise<SeekResult> {
    return this.runMatchmakerRouted<SeekResult, WireSeekResult>(
      MM_RPC.SEEK,
      { user: toWireSeekUser(user), tc },
      // eslint-disable-next-line typescript/unbound-method
      this.seekResultFromWire,
      this.seekLocal.bind(this, user, tc),
    );
  }

  private async seekLocal(user: User, tc: TimeControl): Promise<SeekResult> {
    if (!isValidTimeControl(tc)) {
      throw new BadRequestException('Invalid time control');
    }
    if (this.seeksByUser.has(user.id)) {
      throw new ConflictException(
        'Already in the matchmaking queue - cancel it first',
      );
    }

    const gameType = classifyTimeControl(tc);
    // Guests never get a persisted Rating row (their games are always
    // unrated) - use the starting rating as a pairing placeholder instead
    // of writing a row that will never be updated.
    const rating = user.isGuest
      ? STARTING_RATING
      : (await this.usersService.getOrCreateRating(user.id, gameType)).rating;

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

    // createGame handles its own ownership routing (see games.service.ts) -
    // the new game need not be owned by this (the matchmaker) worker.
    const game = await this.gamesService.createGame(white, black, tc, true);
    return { status: 'matched', game };
  }

  cancelSeek(userId: string): void {
    // Best-effort cleanup (seek cancellation, disconnect, etc.) - nothing
    // downstream awaits this, so a dropped/delayed forward just means a
    // stale seek lingers briefly rather than breaking a user-facing flow.
    void this.runMatchmakerRouted(
      MM_RPC.CANCEL,
      { userId },
      // eslint-disable-next-line typescript/unbound-method
      this.wireToVoid,
      this.cancelSeekLocal.bind(this, userId),
    ).catch(() => {});
  }

  private cancelSeekLocal(userId: string): void {
    this.seeksByUser.delete(userId);
  }

  async getStatus(userId: string): Promise<SeekStatus> {
    // eslint-disable-next-line typescript/unbound-method
    return this.runMatchmakerRouted(
      MM_RPC.STATUS,
      { userId },
      this.statusFromWire,
      this.getStatusLocal.bind(this, userId),
    );
  }

  private getStatusLocal(userId: string): SeekStatus {
    const seek = this.seeksByUser.get(userId);
    if (!seek) return { seeking: false };
    return {
      seeking: true,
      minutes: seek.minutes,
      incrementSeconds: seek.incrementSeconds,
    };
  }

  private findCompatibleSeek(
    userId: string,
    tc: TimeControl,
    rating: number,
  ): Seek | undefined {
    const RATING_WINDOW = 400;
    let best: Seek | undefined;
    let bestDiff = Infinity;

    for (const seek of this.seeksByUser.values()) {
      if (seek.userId === userId) continue;
      if (
        seek.minutes !== tc.minutes ||
        seek.incrementSeconds !== tc.incrementSeconds
      )
        continue;
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
