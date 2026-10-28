import { Controller, Get, Param, ParseEnumPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  GameSummaryDto,
  toGameSummaryDto,
} from '../games/dto/game-summary.dto.js';
import { UserFriendDto } from '../friends/dto/friend.dto.js';
import { ListGamesQuery } from '../games/dto/list-games.query.js';
import { GamesService } from '../games/games.service.js';
import { UsersService } from '../users/users.service.js';
import type { GameType } from '../chess/time-control.js';
import { GAME_TYPES } from '../users/users.service.js';
import { ActivityDayDto, PublicProfileDto } from './dto/public-profile.dto.js';
import {
  DEFAULT_RATING_STATS_PERIOD,
  RatingStatsDto,
  RatingStatsQuery,
} from './dto/rating-stats.dto.js';
import {
  DEFAULT_USER_SEARCH_LIMIT,
  SearchUsersQuery,
} from './dto/search-users.query.js';
import {
  toUserSearchResultDto,
  UserSearchResultDto,
} from './dto/user-search-result.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly gamesService: GamesService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Registered users whose username or display name contains the search term, closest first and leaving you out, a page at a time',
  })
  async search(
    @CurrentUser() viewer: AuthenticatedUser,
    @Query() query: SearchUsersQuery,
  ): Promise<UserSearchResultDto[]> {
    const users = await this.usersService.search(
      query.search,
      viewer.userId,
      query.limit ?? DEFAULT_USER_SEARCH_LIMIT,
      query.offset,
    );
    return users.map(toUserSearchResultDto);
  }

  @Get(':username')
  @ApiOperation({
    summary:
      "A user's public profile: ratings, presence, totals, and your friendship and score with them",
  })
  getProfile(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<PublicProfileDto> {
    return this.profilesService.getProfile(viewer.userId, username);
  }

  @Get(':username/friends')
  @ApiOperation({
    summary: "A user's friends, the most recently added first",
  })
  getFriends(@Param('username') username: string): Promise<UserFriendDto[]> {
    return this.profilesService.getFriends(username);
  }

  @Get(':username/activity')
  @ApiOperation({
    summary: "A user's finished games over the last 30 days, by day",
  })
  getActivity(@Param('username') username: string): Promise<ActivityDayDto[]> {
    return this.profilesService.getActivity(username);
  }

  @Get(':username/ratings/:category')
  @ApiOperation({
    summary:
      "A user's rating history and results in one category over a period",
  })
  getRatingStats(
    @Param('username') username: string,
    @Param('category', new ParseEnumPipe(GAME_TYPES)) category: GameType,
    @Query() query: RatingStatsQuery,
  ): Promise<RatingStatsDto> {
    return this.profilesService.getRatingStats(
      username,
      category,
      query.period ?? DEFAULT_RATING_STATS_PERIOD,
    );
  }

  @Get(':username/games')
  @ApiOperation({ summary: "A user's games, most recent first" })
  async getGames(
    @Param('username') username: string,
    @Query() query: ListGamesQuery,
  ): Promise<GameSummaryDto[]> {
    const user = await this.profilesService.findUserOrThrow(username);
    const games = await this.gamesService.listGamesForUser(user.id, query);
    return games.map((game) => toGameSummaryDto(game, user.id));
  }
}
