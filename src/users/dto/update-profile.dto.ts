import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 280, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string | null;
}
