import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, Max, Min } from 'class-validator';

import { MAX_INCREMENT, MAX_MINUTES, MIN_INCREMENT, MIN_MINUTES } from '../../chess/time-control.js';

export class CreateSeekDto {
  @ApiProperty({ minimum: MIN_MINUTES, maximum: MAX_MINUTES })
  @IsNumber()
  @Min(MIN_MINUTES)
  @Max(MAX_MINUTES)
  minutes!: number;

  @ApiProperty({ minimum: MIN_INCREMENT, maximum: MAX_INCREMENT })
  @IsInt()
  @Min(MIN_INCREMENT)
  @Max(MAX_INCREMENT)
  incrementSeconds!: number;
}
