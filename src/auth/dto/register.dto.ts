import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// bcrypt silently truncates/rejects input past 72 bytes - this is that
// algorithm's own fixed limit, not a length this app chose.
const BCRYPT_MAX_PASSWORD_LENGTH = 72;

export class RegisterDto {
  @ApiProperty({ minLength: 3, maxLength: 20, pattern: '^[a-zA-Z0-9_]+$' })
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers, and underscores',
  })
  username!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(BCRYPT_MAX_PASSWORD_LENGTH)
  password!: string;
}
