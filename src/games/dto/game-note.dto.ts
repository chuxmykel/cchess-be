import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

import { MAX_GAME_NOTE_LENGTH } from '../entities/game-note.entity.js';

export class GameNoteDto {
  @ApiProperty({
    description: "Your notes on the game; '' when there are none",
  })
  body!: string;

  @ApiProperty({ type: Date, nullable: true })
  updatedAt!: Date | null;
}

export class SaveGameNoteDto {
  @ApiProperty({
    maxLength: MAX_GAME_NOTE_LENGTH,
    description: "Your notes on the game, replacing any before; '' clears them",
  })
  @IsString()
  @MaxLength(MAX_GAME_NOTE_LENGTH)
  body!: string;
}
