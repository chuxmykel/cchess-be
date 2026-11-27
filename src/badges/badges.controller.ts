import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  list(@Param('username') username: string): Promise<BadgeDto[]> {
    return this.badgesService.list(username);
  }
}
