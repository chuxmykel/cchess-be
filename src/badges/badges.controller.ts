import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/types.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { BadgesService } from './badges.service.js';
import { BadgeDto } from './dto/badge.dto.js';

@ApiTags('badges')
@ApiBearerAuth()
@Controller()
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get('users/:username/badges')
  @ApiOperation({
    summary:
      "A player's badges, the newest first, each with the game that earned it",
  })
  list(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<BadgeDto[]> {
    return this.badgesService.list(username, viewer.userId);
  }

  @Post('badges/:id/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim a badge of your own, shown you' })
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BadgeDto> {
    return this.badgesService.claim(user.userId, id);
  }
}
