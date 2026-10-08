import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class CreateSeekDto {
  @ApiProperty({ minimum: 0, maximum: 180 })
  @IsInt()
  @Min(0)
  @Max(180)
  minutes!: number;

  @ApiProperty({ minimum: 0, maximum: 180 })
  @IsInt()
  @Min(0)
  @Max(180)
  incrementSeconds!: number;
}
