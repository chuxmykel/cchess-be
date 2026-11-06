import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ExplorerQuery {
  @ApiProperty({ description: 'The position, as a FEN' })
  @IsString()
  @MaxLength(100)
  fen!: string;
}

export class ExplorerMoveDto {
  @ApiProperty()
  san!: string;

  @ApiProperty({ example: 'e2e4' })
  uci!: string;

  @ApiProperty({ description: 'Finished games in which it was played here' })
  games!: number;

  @ApiProperty()
  whiteWins!: number;

  @ApiProperty()
  draws!: number;

  @ApiProperty()
  blackWins!: number;
}

export class ExplorerPositionDto {
  @ApiProperty({
    description: 'Finished games that reached the position and went on',
  })
  totalGames!: number;

  @ApiProperty({
    type: [ExplorerMoveDto],
    description: 'The moves played from it, the most played first',
  })
  moves!: ExplorerMoveDto[];
}
