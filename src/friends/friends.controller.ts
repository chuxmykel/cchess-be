import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto.js';
import { FriendDto, FriendRequestDto, toFriendDto } from './dto/friend.dto.js';
import { FriendsService } from './friends.service.js';

@ApiTags('friends')
@ApiBearerAuth()
@Controller()
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get('friends')
  @ApiOperation({ summary: 'List accepted friends' })
  async listFriends(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FriendDto[]> {
    const friends = await this.friendsService.listFriends(user.userId);
    return friends.map(toFriendDto);
  }

  @Get('friends/requests')
  @ApiOperation({
    summary: 'List incoming and outgoing pending friend requests',
  })
  async listRequests(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ incoming: FriendRequestDto[]; outgoing: FriendRequestDto[] }> {
    const [incoming, outgoing] = await Promise.all([
      this.friendsService.listIncomingRequests(user.userId),
      this.friendsService.listOutgoingRequests(user.userId),
    ]);
    return {
      incoming: incoming.map((r) => ({
        id: r.id,
        user: toFriendDto(r.requester),
        createdAt: r.createdAt,
      })),
      outgoing: outgoing.map((r) => ({
        id: r.id,
        user: toFriendDto(r.addressee),
        createdAt: r.createdAt,
      })),
    };
  }

  @Post('friends/requests')
  @ApiOperation({ summary: 'Send a friend request by username' })
  async sendRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFriendRequestDto,
  ) {
    const friendship = await this.friendsService.sendRequest(
      user.userId,
      dto.username,
    );
    return { id: friendship.id, status: friendship.status };
  }

  @Post('friends/requests/:id/accept')
  @ApiOperation({ summary: 'Accept an incoming friend request' })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const friendship = await this.friendsService.respond(user.userId, id, true);
    return { id: friendship.id, status: friendship.status };
  }

  @Post('friends/requests/:id/decline')
  @ApiOperation({ summary: 'Decline an incoming friend request' })
  async decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const friendship = await this.friendsService.respond(
      user.userId,
      id,
      false,
    );
    return { id: friendship.id, status: friendship.status };
  }

  @Delete('friends/requests/:id')
  @ApiOperation({ summary: 'Cancel an outgoing friend request' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.friendsService.cancelOutgoing(user.userId, id);
  }

  @Delete('friends/:username')
  @ApiOperation({ summary: 'Remove a friend' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<void> {
    await this.friendsService.removeFriend(user.userId, username);
  }
}
