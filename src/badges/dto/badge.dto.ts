import { ApiProperty } from '@nestjs/swagger';

import { BADGE_KINDS, type BadgeKind } from '../badge-kinds.js';

export class BadgeGameDto {
  @ApiProperty()
  gameId!: string;

  @ApiProperty()
  opponentUsername!: string;

  @ApiProperty()
  opponentDisplayName!: string;

  @ApiProperty({ enum: ['win', 'loss', 'draw'], nullable: true })
  result!: 'win' | 'loss' | 'draw' | null;

  @ApiProperty({ type: String, nullable: true })
  endedAt!: Date | null;
}

export class BadgeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: BADGE_KINDS })
  kind!: BadgeKind;

  @ApiProperty({
    type: BadgeGameDto,
    nullable: true,
    description: 'The game that earned it',
  })
  game!: BadgeGameDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "A rating milestone's category",
  })
  category!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "A milestone's number: games played, or the rating crossed",
  })
  value!: number | null;

  @ApiProperty({ description: 'When it was earned' })
  awardedAt!: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When its owner claimed it - null to anyone else',
  })
  claimedAt!: Date | null;
}
