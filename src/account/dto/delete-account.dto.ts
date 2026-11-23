import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description: "The account's password - required unless it's a guest",
  })
  @IsOptional()
  @IsString()
  @MaxLength(72)
  password?: string;
}
