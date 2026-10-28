import { ApiProperty } from '@nestjs/swagger';

import {
  CHAT_MESSAGE_KINDS,
  type ChatMessageKind,
  type GameChatMessage,
} from '../entities/game-chat-message.entity.js';

export class ChatMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  gameId!: string;

  @ApiProperty({
    description: 'The player who sent it, or who did what a note notes',
  })
  userId!: string;

  @ApiProperty({
    enum: CHAT_MESSAGE_KINDS,
    description:
      "'message' for a player's words; otherwise a note of a draw offered, declined or accepted, with empty text",
  })
  kind!: ChatMessageKind;

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
    kind: message.kind,
    text: message.text,
    createdAt: message.createdAt,
  };
}
