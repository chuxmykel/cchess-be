import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/types.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { BlocksService } from './blocks.service.js';
import {
  type BlockedUserDto,
  toBlockedUserDto,
} from './dto/blocked-user.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get('me/blocks')
  @ApiOperation({ summary: "The players you've blocked, the latest first" })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BlockedUserDto[]> {
    return (await this.blocksService.list(user.userId)).map(toBlockedUserDto);
  }

  @Post(':username/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Block a player: no friending, challenges, chat or pairing either way; ends a friendship',
  })
  async block(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<void> {
    await this.blocksService.block(user.userId, username);
  }

  @Delete(':username/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unblock a player' })
  async unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<void> {
    await this.blocksService.unblock(user.userId, username);
  }
}
