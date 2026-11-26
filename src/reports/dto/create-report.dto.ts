import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import {
  MAX_REPORT_DETAILS_LENGTH,
  REPORT_REASONS,
  type ReportReason,
} from '../entities/report.entity.js';

export class CreateReportDto {
  @ApiProperty({ description: 'The player reported' })
  @IsString()
  @MaxLength(32)
  username!: string;

  @ApiProperty({ enum: REPORT_REASONS })
  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  @ApiPropertyOptional({ maxLength: MAX_REPORT_DETAILS_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPORT_DETAILS_LENGTH)
  details?: string;

  @ApiPropertyOptional({
    description: 'The game, for a game chat message - or the game itself',
  })
  @IsOptional()
  @IsUUID()
  gameId?: string;

  @ApiPropertyOptional({
    description:
      "The message reported: a chat message of gameId's, or else a direct message they sent you",
  })
  @IsOptional()
  @IsUUID()
  messageId?: string;
}
