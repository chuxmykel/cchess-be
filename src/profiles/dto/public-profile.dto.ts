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

export class PuzzleRatingSummaryDto {
  @ApiProperty()
  rating!: number;

  @ApiProperty({ description: 'Pool puzzles tried' })
  attempts!: number;

  @ApiProperty({
    description:
      'Whether the rating is still uncertain (rating deviation above 110)',
  })
  provisional!: boolean;
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

  @ApiProperty()
  friendsCount!: number;

  @ApiProperty({ type: ViewerFriendshipDto })
  friendship!: ViewerFriendshipDto;

  @ApiPropertyOptional({
    type: ScoreDto,
    nullable: true,
    description: "The viewer's results against this user; null on your own",
  })
  score!: ScoreDto | null;

  @ApiProperty({ description: "Whether you've blocked this player" })
  blockedByYou!: boolean;

  @ApiProperty({
    type: PuzzleRatingSummaryDto,
    nullable: true,
    description: 'Their puzzle rating; null until they try a pool puzzle',
  })
  puzzleRating!: PuzzleRatingSummaryDto | null;
}

export class ActivityDayDto extends ScoreDto {
  @ApiProperty({ description: 'The UTC day, YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ enum: ['bullet', 'blitz', 'rapid', 'classical', 'daily'] })
  category!: string;

  @ApiProperty()
  games!: number;

  @ApiProperty({ type: Number, nullable: true })
  ratingAfter!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  ratingDiff!: number | null;
}
