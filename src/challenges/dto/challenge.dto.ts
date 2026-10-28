import { ApiProperty } from '@nestjs/swagger';

import {
  classifyTimeControl,
  type GameType,
} from '../../chess/time-control.js';
import type { User } from '../../users/entities/user.entity.js';
import { challengeExpiresAt } from '../challenge-expiry.js';

import type {
  Challenge,
  ChallengeStatus,
  ColorPreference,
} from '../entities/challenge.entity.js';

export class ChallengeUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;
}

export class ChallengeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: ChallengeUserDto })
  challenger!: ChallengeUserDto;

  @ApiProperty({ type: ChallengeUserDto })
  opponent!: ChallengeUserDto;

  @ApiProperty()
  initialSeconds!: number;

  @ApiProperty()
  incrementSeconds!: number;

  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical'] })
  gameType!: GameType;

  @ApiProperty()
  rated!: boolean;

  @ApiProperty({ enum: ['white', 'black', 'random'] })
  challengerColor!: ColorPreference;

  @ApiProperty({
    enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'],
  })
  status!: ChallengeStatus;

  @ApiProperty({ nullable: true })
  gameId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'When an unanswered challenge expires' })
  expiresAt!: Date;
}

function toChallengeUserDto(user: User): ChallengeUserDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
  };
}

export function toChallengeDto(challenge: Challenge): ChallengeDto {
  return {
    id: challenge.id,
    challenger: toChallengeUserDto(challenge.challenger),
    opponent: toChallengeUserDto(challenge.opponent),
    initialSeconds: challenge.initialSeconds,
    incrementSeconds: challenge.incrementSeconds,
    gameType: classifyTimeControl(challenge),
    rated: challenge.rated,
    challengerColor: challenge.challengerColor,
    status: challenge.status,
    gameId: challenge.gameId,
    createdAt: challenge.createdAt,
    expiresAt: challengeExpiresAt(challenge),
  };
}
