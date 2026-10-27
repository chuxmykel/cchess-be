import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import type { DirectMessage } from '../entities/direct-message.entity.js';

export const DEFAULT_MESSAGES_PAGE = 50;
export const MAX_MESSAGES_PAGE = 100;

export class DirectMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  senderId!: string;

  @ApiProperty()
  recipientId!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class SendDirectMessageDto {
  @ApiProperty()
  @IsString()
  text!: string;
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

export function toDirectMessageDto(message: DirectMessage): DirectMessageDto {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    text: message.text,
    createdAt: message.createdAt,
  };
}
