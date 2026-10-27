import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const DEFAULT_USER_SEARCH_LIMIT = 10;
export const MAX_USER_SEARCH_LIMIT = 20;
const MAX_SEARCH_LENGTH = 30;

export class SearchUsersQuery {
  @ApiProperty({
    description: 'Part of a username or display name, any case',
    maxLength: MAX_SEARCH_LENGTH,
  })
  @IsString()
  @Length(1, MAX_SEARCH_LENGTH)
  search!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_USER_SEARCH_LIMIT,
    default: DEFAULT_USER_SEARCH_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_USER_SEARCH_LIMIT)
  limit?: number;
}
