import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ProfileDto } from '../../users/dto/profile.dto.js';

export type FriendshipStatus =
  'self' | 'none' | 'friends' | 'outgoing' | 'incoming';

export class ScoreDto {
  @ApiProperty()
  wins!: number;

  @ApiProperty()
  draws!: number;

  @ApiProperty()
  losses!: number;
}

export class ViewerFriendshipDto {
  @ApiProperty({ enum: ['self', 'none', 'friends', 'outgoing', 'incoming'] })
  status!: FriendshipStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The pending request, when there is one',
  })
  requestId!: string | null;
}

export class PublicProfileDto extends ProfileDto {
  @ApiProperty({ nullable: true })
  lastSeenAt!: Date | null;

  @ApiProperty()
  online!: boolean;

  @ApiProperty({ type: String, nullable: true })
  playingGameId!: string | null;

  @ApiProperty({ description: 'Finished games, every category' })
  gamesPlayed!: number;

  @ApiProperty({ description: 'Time spent in finished games' })
  timePlayedMs!: number;

  @ApiProperty({ type: ViewerFriendshipDto })
  friendship!: ViewerFriendshipDto;

  @ApiPropertyOptional({
    type: ScoreDto,
    nullable: true,
    description: "The viewer's results against this user; null on your own",
  })
  score!: ScoreDto | null;
}

export class ActivityDayDto extends ScoreDto {
  @ApiProperty({ description: 'The UTC day, YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical'] })
  category!: string;

  @ApiProperty()
  games!: number;

  @ApiProperty({ type: Number, nullable: true })
  ratingAfter!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  ratingDiff!: number | null;
}
