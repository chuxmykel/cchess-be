import { ApiProperty } from '@nestjs/swagger';

import type { User } from '../../users/entities/user.entity.js';

export class UserSearchResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  avatarColor!: string;

  @ApiProperty({ description: 'A computer opponent' })
  isBot!: boolean;
}

export function toUserSearchResultDto(user: User): UserSearchResultDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    isBot: user.isBot,
  };
}
