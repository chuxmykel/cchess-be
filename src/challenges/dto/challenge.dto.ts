import { ApiProperty } from '@nestjs/swagger';

import type { Challenge, ChallengeStatus, ColorPreference } from '../entities/challenge.entity.js';

export class ChallengeUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;
}

export class ChallengeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: ChallengeUserDto })
  challenger!: ChallengeUserDto;

  @ApiProperty({ type: ChallengeUserDto })
  opponent!: ChallengeUserDto;

  @ApiProperty()
  minutes!: number;

  @ApiProperty()
  incrementSeconds!: number;

  @ApiProperty({ enum: ['white', 'black', 'random'] })
  challengerColor!: ColorPreference;

  @ApiProperty({ enum: ['pending', 'accepted', 'declined', 'cancelled'] })
  status!: ChallengeStatus;

  @ApiProperty({ nullable: true })
  gameId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export function toChallengeDto(challenge: Challenge): ChallengeDto {
  return {
    id: challenge.id,
    challenger: {
      id: challenge.challenger.id,
      username: challenge.challenger.username,
      displayName: challenge.challenger.displayName,
    },
    opponent: {
      id: challenge.opponent.id,
      username: challenge.opponent.username,
      displayName: challenge.opponent.displayName,
    },
    minutes: challenge.minutes,
    incrementSeconds: challenge.incrementSeconds,
    challengerColor: challenge.challengerColor,
    status: challenge.status,
    gameId: challenge.gameId,
    createdAt: challenge.createdAt,
  };
}
