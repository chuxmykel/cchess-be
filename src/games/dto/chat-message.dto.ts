import { ApiProperty } from '@nestjs/swagger';

import type { GameChatMessage } from '../entities/game-chat-message.entity.js';

export class ChatMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  gameId!: string;

  @ApiProperty({ description: 'The player who sent it' })
  userId!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty()
  createdAt!: Date;
}

export function toChatMessageDto(message: GameChatMessage): ChatMessageDto {
  return {
    id: message.id,
    gameId: message.gameId,
    userId: message.userId,
    text: message.text,
    createdAt: message.createdAt,
  };
}
