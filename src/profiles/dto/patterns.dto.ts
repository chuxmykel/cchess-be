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
      "The player's reviewed games over the period, newest first - to the player alone",
  })
  games!: PatternGameDto[];
}
