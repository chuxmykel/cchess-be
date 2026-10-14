import { ApiProperty } from '@nestjs/swagger';

import type { GameType } from '../../chess/time-control.js';
import type { Rating } from '../entities/rating.entity.js';
import type { User } from '../entities/user.entity.js';

export class RatingDto {
  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical'] })
  category!: GameType;

  @ApiProperty()
  rating!: number;

  @ApiProperty()
  gamesPlayed!: number;
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
}

export function toRatingDto(rating: Rating): RatingDto {
  return {
    category: rating.category,
    rating: rating.rating,
    gamesPlayed: rating.gamesPlayed,
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
  };
}
