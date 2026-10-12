import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class DrawRespondDto {
  @ApiProperty()
  @IsBoolean()
  accept!: boolean;
}
