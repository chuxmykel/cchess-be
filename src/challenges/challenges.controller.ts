import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { toGameStateDto } from '../games/dto/game-state.dto.js';
import { UsersService } from '../users/users.service.js';
import { ChallengesService } from './challenges.service.js';
import { ChallengeDto, toChallengeDto } from './dto/challenge.dto.js';
import { CreateChallengeDto } from './dto/create-challenge.dto.js';

@ApiTags('challenges')
@ApiBearerAuth()
@Controller('challenges')
export class ChallengesController {
  constructor(
    private readonly challengesService: ChallengesService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List incoming and outgoing pending challenges' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ incoming: ChallengeDto[]; outgoing: ChallengeDto[] }> {
    const [incoming, outgoing] = await Promise.all([
      this.challengesService.listIncoming(user.userId),
      this.challengesService.listOutgoing(user.userId),
    ]);
    return {
      incoming: incoming.map(toChallengeDto),
      outgoing: outgoing.map(toChallengeDto),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Challenge another user (e.g. a friend) to a game' })
  async create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateChallengeDto,
  ): Promise<ChallengeDto> {
    const challenger = await this.usersService.findByIdOrThrow(
      currentUser.userId,
    );
    const challenge = await this.challengesService.create(
      challenger,
      dto.opponentUsername,
      {
        initialSeconds: dto.initialSeconds,
        incrementSeconds: dto.incrementSeconds,
      },
      { color: dto.color, rated: dto.rated },
    );
    return toChallengeDto(challenge);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept a challenge, starting the game' })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const { game } = await this.challengesService.accept(user.userId, id);
    return toGameStateDto(game);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline a challenge' })
  async decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ChallengeDto> {
    const challenge = await this.challengesService.decline(user.userId, id);
    return toChallengeDto(challenge);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an outgoing challenge' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ChallengeDto> {
    const challenge = await this.challengesService.cancel(user.userId, id);
    return toChallengeDto(challenge);
  }
}
