import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  ConversationDto,
  DirectMessageDto,
  ListConversationsQuery,
  ListMessagesQuery,
  SeenDto,
  SendDirectMessageDto,
  toDirectMessageDto,
  UnreadCountDto,
} from './dto/direct-message.dto.js';
import { MessagesService } from './messages.service.js';

@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Your conversations, newest message first: who with, the last message, unread, and when they last read yours',
  })
  conversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListConversationsQuery,
  ): Promise<ConversationDto[]> {
    return this.messagesService.conversationsOf(user.userId, query);
  }

  @Get('unread')
  @ApiOperation({ summary: 'Unread message counts, by sender' })
  unread(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountDto[]> {
    return this.messagesService.unreadCounts(user.userId);
  }

  @Get(':username')
  @ApiOperation({
    summary: 'Messages with a user, newest first, since you last cleared them',
  })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
    @Query() query: ListMessagesQuery,
  ): Promise<DirectMessageDto[]> {
    const messages = await this.messagesService.history(
      user.userId,
      username,
      query,
    );
    return messages.map(toDirectMessageDto);
  }

  @Get(':username/seen')
  @ApiOperation({ summary: 'When the user last read your messages' })
  async seen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<SeenDto> {
    return {
      theirLastReadAt: await this.messagesService.theirLastReadAt(
        user.userId,
        username,
      ),
    };
  }

  @Post(':username')
  @ApiOperation({ summary: 'Message a friend' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
    @Body() dto: SendDirectMessageDto,
  ): Promise<DirectMessageDto> {
    const message = await this.messagesService.send(
      user.userId,
      username,
      dto.text,
      dto.attachment,
    );
    return toDirectMessageDto(message);
  }

  @Post(':username/read')
  @ApiOperation({ summary: 'Mark your messages with a user as read' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<void> {
    await this.messagesService.markRead(user.userId, username);
  }

  @Delete(':username')
  @ApiOperation({
    summary: 'Clear your messages with a user (only for you)',
  })
  async clear(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ): Promise<void> {
    await this.messagesService.clear(user.userId, username);
  }
}
