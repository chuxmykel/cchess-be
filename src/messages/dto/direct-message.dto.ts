import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import type { MessageAttachment } from '../attachment.js';
import type { DirectMessage } from '../entities/direct-message.entity.js';

export const DEFAULT_MESSAGES_PAGE = 50;
export const MAX_MESSAGES_PAGE = 100;
export const DEFAULT_CONVERSATIONS_PAGE = 30;
export const MAX_CONVERSATIONS_PAGE = 100;

export class DirectMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  senderId!: string;

  @ApiProperty()
  recipientId!: string;

  @ApiProperty({ description: 'Empty when the message is only its attachment' })
  text!: string;

  @ApiProperty({
    nullable: true,
    description:
      "A game ({ kind: 'game', gameId }) or position ({ kind: 'position', fen }) sent with it",
  })
  attachment!: MessageAttachment | null;

  @ApiProperty()
  createdAt!: Date;
}

export class SendDirectMessageDto {
  @ApiPropertyOptional({ description: 'May be left out with an attachment' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    description:
      "A game ({ kind: 'game', gameId }) or position ({ kind: 'position', fen }) to send",
  })
  @IsOptional()
  @IsObject()
  attachment?: Record<string, unknown>;
}

export class ListMessagesQuery {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_MESSAGES_PAGE,
    default: DEFAULT_MESSAGES_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGES_PAGE)
  limit?: number;

  @ApiPropertyOptional({
    description: 'ISO date - only messages sent before this',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}

export class UnreadCountDto {
  @ApiProperty({ description: 'Who sent the unread messages' })
  userId!: string;

  @ApiProperty()
  count!: number;
}

export class ConversationUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;
}

export class ConversationDto {
  @ApiProperty({ type: ConversationUserDto })
  user!: ConversationUserDto;

  @ApiProperty({
    type: DirectMessageDto,
    description: 'The newest message since you last cleared the conversation',
  })
  lastMessage!: DirectMessageDto;

  @ApiProperty({ description: 'Messages from them you have not read' })
  unreadCount!: number;

  @ApiProperty({
    nullable: true,
    description: 'When they last read your messages - none until they have',
  })
  theirLastReadAt!: Date | null;
}

export class ListConversationsQuery {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_CONVERSATIONS_PAGE,
    default: DEFAULT_CONVERSATIONS_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CONVERSATIONS_PAGE)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'ISO date - only conversations whose last message is older: the page after one ending there',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}

export class SeenDto {
  @ApiProperty({
    nullable: true,
    description: 'When they last read your messages - none until they have',
  })
  theirLastReadAt!: Date | null;
}

export function toDirectMessageDto(message: DirectMessage): DirectMessageDto {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    text: message.text,
    attachment: message.attachment ?? null,
    createdAt: message.createdAt,
  };
}
