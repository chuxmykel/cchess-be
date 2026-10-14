import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const;

export class MakeMoveDto {
  @ApiProperty({ example: 'e2' })
  @IsString()
  @Length(2, 2)
  from!: string;

  @ApiProperty({ example: 'e4' })
  @IsString()
  @Length(2, 2)
  to!: string;

  @ApiPropertyOptional({ enum: PROMOTION_PIECES })
  @IsOptional()
  @IsIn(PROMOTION_PIECES)
  promotion?: (typeof PROMOTION_PIECES)[number];
}
