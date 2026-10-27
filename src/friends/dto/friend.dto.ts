import { ApiProperty } from '@nestjs/swagger';

import { RatingDto, toRatingDto } from '../../users/dto/profile.dto.js';
import type { Rating } from '../../users/entities/rating.entity.js';
import type { User } from '../../users/entities/user.entity.js';

export class FriendDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;

  @ApiProperty({ nullable: true })
  lastSeenAt!: Date | null;

  @ApiProperty()
  online!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The game they are playing right now, if any',
  })
  playingGameId!: string | null;

  @ApiProperty({ type: [RatingDto] })
  ratings!: RatingDto[];
}

export class FriendRequestDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: FriendDto })
  user!: FriendDto;

  @ApiProperty()
  createdAt!: Date;
}

export interface FriendStatus {
  online: boolean;
  playingGameId: string | null;
  ratings: Rating[];
}

export function toFriendDto(user: User, status: FriendStatus): FriendDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    lastSeenAt: user.lastSeenAt,
    online: status.online,
    playingGameId: status.playingGameId,
    ratings: status.ratings.map(toRatingDto),
  };
}
