import { ApiProperty } from '@nestjs/swagger';

import type { UserBlock } from '../entities/user-block.entity.js';

export class BlockedUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;

  @ApiProperty()
  blockedAt!: Date;
}

export function toBlockedUserDto(block: UserBlock): BlockedUserDto {
  return {
    id: block.blocked.id,
    username: block.blocked.username,
    displayName: block.blocked.displayName,
    avatarColor: block.blocked.avatarColor,
    blockedAt: block.createdAt,
  };
}
