import { ApiProperty } from '@nestjs/swagger';

import type { SideDigest } from '../../games/review-digests.js';

export class PatternGameDto {
  @ApiProperty()
  gameId!: string;

  @ApiProperty({ enum: ['w', 'b'] })
  color!: 'w' | 'b';

  @ApiProperty({ nullable: true })
  endedAt!: Date | null;

  @ApiProperty({ description: "The player's side of the review, boiled down" })
  digest!: SideDigest;
}

export class PatternsDto {
  @ApiProperty({
    type: [PatternGameDto],
    description:
      "The player's last reviewed games, newest first - to the player alone",
  })
  games!: PatternGameDto[];

  @ApiProperty({
    description: 'How many of each badge their reviewed games earned them',
  })
  badges!: Record<string, number>;
}
