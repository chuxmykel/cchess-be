import { ApiProperty } from '@nestjs/swagger';

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
}

export class FriendRequestDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: FriendDto })
  user!: FriendDto;

  @ApiProperty()
  createdAt!: Date;
}

export function toFriendDto(user: User): FriendDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    lastSeenAt: user.lastSeenAt,
  };
}
