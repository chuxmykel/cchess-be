import { ApiProperty } from '@nestjs/swagger';

import type { GameType } from '../../chess/time-control.js';
import { TERMS_VERSION } from '../../legal/legal.js';
import { isProvisional, type Rating } from '../entities/rating.entity.js';
import type { User } from '../entities/user.entity.js';

export class RatingDto {
  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical', 'daily'] })
  category!: GameType;

  @ApiProperty()
  rating!: number;

  @ApiProperty()
  gamesPlayed!: number;

  @ApiProperty({
    description:
      'Whether the rating is still uncertain (rating deviation above 110)',
  })
  provisional!: boolean;
}

export class ProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true })
  bio!: string | null;

  @ApiProperty()
  avatarColor!: string;

  @ApiProperty()
  isGuest!: boolean;

  @ApiProperty({ type: [RatingDto] })
  ratings!: RatingDto[];

  @ApiProperty()
  createdAt!: Date;
}

export class MeDto extends ProfileDto {
  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ description: 'Whether the email has been verified' })
  emailVerified!: boolean;

  @ApiProperty({
    description:
      "Whether you chat in games with players who aren't your friends",
  })
  chatWithStrangers!: boolean;

  @ApiProperty({
    description:
      'Whether the account has accepted the terms in force - false for guests, and when they change',
  })
  termsAccepted!: boolean;
}

export function toRatingDto(rating: Rating): RatingDto {
  return {
    category: rating.category,
    rating: Math.round(rating.rating),
    gamesPlayed: rating.gamesPlayed,
    provisional: isProvisional(rating.deviation),
  };
}

export function toProfileDto(user: User, ratings: Rating[]): ProfileDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarColor: user.avatarColor,
    isGuest: user.isGuest,
    ratings: ratings.map(toRatingDto),
    createdAt: user.createdAt,
  };
}

export function toMeDto(user: User, ratings: Rating[]): MeDto {
  const profile = toProfileDto(user, ratings);
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarColor: profile.avatarColor,
    isGuest: profile.isGuest,
    ratings: profile.ratings,
    createdAt: profile.createdAt,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    chatWithStrangers: user.chatWithStrangers,
    termsAccepted: user.termsVersion === TERMS_VERSION,
  };
}
