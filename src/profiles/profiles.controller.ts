import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  GameSummaryDto,
  toGameSummaryDto,
} from '../games/dto/game-summary.dto.js';
import { ListGamesQuery } from '../games/dto/list-games.query.js';
import { GamesService } from '../games/games.service.js';
import { ActivityDayDto, PublicProfileDto } from './dto/public-profile.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly gamesService: GamesService,
  ) {}

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

  @Get(':username/activity')
  @ApiOperation({
    summary: "A user's finished games over the last 30 days, by day",
  })
  getActivity(@Param('username') username: string): Promise<ActivityDayDto[]> {
    return this.profilesService.getActivity(username);
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
