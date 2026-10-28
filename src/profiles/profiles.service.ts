import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Game } from '../games/entities/game.entity.js';
import { GamesService } from '../games/games.service.js';
import { FriendsService } from '../friends/friends.service.js';
import { PresenceService } from '../presence/presence.service.js';
import type { GameType } from '../chess/time-control.js';
import { toProfileDto, toRatingDto } from '../users/dto/profile.dto.js';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type {
  PublicProfileDto,
  ViewerFriendshipDto,
} from './dto/public-profile.dto.js';
import type { NotableGameDto, RatingStatsDto } from './dto/rating-stats.dto.js';
import { type ActivityDay, scoreFor, summarizeActivity } from './game-stats.js';
import {
  type NotableGame,
  periodStart,
  type RatingStatsGame,
  type RatingStatsPeriod,
  summarizeRatingStats,
} from './rating-stats.js';

const ACTIVITY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Another player's profile as one viewer sees it. */
@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    private readonly usersService: UsersService,
    private readonly gamesService: GamesService,
    private readonly friendsService: FriendsService,
    private readonly presenceService: PresenceService,
  ) {}

  async findUserOrThrow(username: string): Promise<User> {
    const user = await this.usersService.findByUsername(username);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getProfile(
    viewerId: string,
    username: string,
  ): Promise<PublicProfileDto> {
    const user = await this.findUserOrThrow(username);
    const isSelf = user.id === viewerId;
    const [ratings, online, playing, totals, friendship, score] =
      await Promise.all([
        this.usersService.getRatings(user.id),
        this.presenceService.isOnline(user.id),
        this.gamesService.activeGameIdsFor([user.id]),
        this.finishedGameTotals(user.id),
        this.viewerFriendship(viewerId, user.id),
        isSelf ? null : this.scoreAgainst(viewerId, user.id),
      ]);
    const profile = toProfileDto(user, ratings);
    return {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarColor: profile.avatarColor,
      isGuest: profile.isGuest,
      ratings: profile.ratings,
      createdAt: profile.createdAt,
      lastSeenAt: user.lastSeenAt,
      online,
      playingGameId: playing.get(user.id) ?? null,
      ...totals,
      friendship,
      score,
    };
  }

  async getActivity(username: string): Promise<ActivityDay[]> {
    const user = await this.findUserOrThrow(username);
    const games = await this.games
      .createQueryBuilder('g')
      .where('(g.whiteId = :userId OR g.blackId = :userId)', {
        userId: user.id,
      })
      .andWhere("g.status = 'completed'")
      .andWhere('g.endedAt > :since', {
        since: new Date(Date.now() - ACTIVITY_DAYS * DAY_MS),
      })
      .getMany();
    return summarizeActivity(games, user.id);
  }

  async getRatingStats(
    username: string,
    category: GameType,
    period: RatingStatsPeriod,
  ): Promise<RatingStatsDto> {
    const user = await this.findUserOrThrow(username);
    const rating = await this.usersService.findRating(user.id, category);
    if (!rating) throw new NotFoundException('No rating in this category');
    // Only the columns the figures need, as plain rows: a long history is
    // tens of thousands of games, and loading them as entities with both
    // players was most of the time spent.
    const query = this.games
      .createQueryBuilder('g')
      .select([
        'g.id AS id',
        'g.whiteId AS "whiteId"',
        'g.blackId AS "blackId"',
        'g.result AS result',
        'g.rated AS rated',
        'g.createdAt AS "createdAt"',
        'g.endedAt AS "endedAt"',
        'g.whiteRatingAtStart AS "whiteRatingAtStart"',
        'g.blackRatingAtStart AS "blackRatingAtStart"',
        'g.whiteRatingDiff AS "whiteRatingDiff"',
        'g.blackRatingDiff AS "blackRatingDiff"',
      ])
      .where('(g.whiteId = :userId OR g.blackId = :userId)', {
        userId: user.id,
      })
      .andWhere("g.status = 'completed'")
      .andWhere('g.gameType = :category', { category });
    const since = periodStart(period, new Date());
    if (since) query.andWhere('g.endedAt > :since', { since });
    const games = await query.getRawMany<RatingStatsGame>();
    const stats = summarizeRatingStats(games, user.id);
    const [bestWin, worstLoss] = await Promise.all([
      this.describeNotableGame(stats.bestWin),
      this.describeNotableGame(stats.worstLoss),
    ]);
    return {
      period,
      rating: toRatingDto(rating),
      ...stats,
      bestWin,
      worstLoss,
    };
  }

  /** Names the opponent of a game the stats picked out. */
  private async describeNotableGame(
    game: NotableGame | null,
  ): Promise<NotableGameDto | null> {
    if (!game) return null;
    const opponent = await this.usersService.findById(game.opponentId);
    if (!opponent) return null;
    return {
      gameId: game.gameId,
      opponentUsername: opponent.username,
      opponentDisplayName: opponent.displayName,
      opponentRating: game.opponentRating,
      endedAt: game.endedAt,
    };
  }

  private async finishedGameTotals(
    userId: string,
  ): Promise<{ gamesPlayed: number; timePlayedMs: number }> {
    const row = await this.games
      .createQueryBuilder('g')
      .select('COUNT(*)', 'gamesPlayed')
      .addSelect(
        'COALESCE(SUM(EXTRACT(EPOCH FROM (g.endedAt - g.createdAt)) * 1000), 0)',
        'timePlayedMs',
      )
      .where('(g.whiteId = :userId OR g.blackId = :userId)', { userId })
      .andWhere("g.status = 'completed'")
      .getRawOne<{ gamesPlayed: string; timePlayedMs: string }>();
    return {
      gamesPlayed: Number(row?.gamesPlayed ?? 0),
      timePlayedMs: Math.round(Number(row?.timePlayedMs ?? 0)),
    };
  }

  private async scoreAgainst(viewerId: string, userId: string) {
    const games = await this.games.find({
      select: { whiteId: true, blackId: true, result: true },
      where: [
        { whiteId: viewerId, blackId: userId, status: 'completed' },
        { whiteId: userId, blackId: viewerId, status: 'completed' },
      ],
    });
    return scoreFor(games, viewerId);
  }

  private async viewerFriendship(
    viewerId: string,
    userId: string,
  ): Promise<ViewerFriendshipDto> {
    if (viewerId === userId) return { status: 'self', requestId: null };
    const friendship = await this.friendsService.findBetweenUsers(
      viewerId,
      userId,
    );
    if (friendship?.status === 'accepted') {
      return { status: 'friends', requestId: null };
    }
    if (friendship?.status === 'pending') {
      return {
        status: friendship.requesterId === viewerId ? 'outgoing' : 'incoming',
        requestId: friendship.id,
      };
    }
    return { status: 'none', requestId: null };
  }
}
