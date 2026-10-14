import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { toGameStateDto } from '../games/dto/game-state.dto.js';
import { UsersService } from '../users/users.service.js';
import { CreateSeekDto } from './dto/create-seek.dto.js';
import { MatchmakingService } from './matchmaking.service.js';

@ApiTags('matchmaking')
@ApiBearerAuth()
@Controller('matchmaking')
export class MatchmakingController {
  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly usersService: UsersService,
  ) {}

  @Post('seek')
  @ApiOperation({
    summary:
      'Join the matchmaking queue for a time control, or get matched immediately',
  })
  async seek(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateSeekDto,
  ) {
    const user = await this.usersService.findByIdOrThrow(currentUser.userId);
    const result = await this.matchmakingService.seek(user, dto);
    if (result.status === 'matched') {
      return { status: 'matched', game: toGameStateDto(result.game) };
    }
    return result;
  }

  @Delete('seek')
  @ApiOperation({ summary: 'Leave the matchmaking queue' })
  cancel(@CurrentUser() user: AuthenticatedUser): void {
    this.matchmakingService.cancelSeek(user.userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Check whether you are currently queued' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    return this.matchmakingService.getStatus(user.userId);
  }
}
