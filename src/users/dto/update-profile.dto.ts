import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
} from '../entities/user.entity.js';

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: BIO_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(BIO_MAX_LENGTH)
  bio?: string | null;

  @ApiPropertyOptional({
    description: "Chat in games with players who aren't your friends",
  })
  @IsOptional()
  @IsBoolean()
  chatWithStrangers?: boolean;
}
