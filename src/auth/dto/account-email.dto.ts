import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  BCRYPT_MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './register.dto.js';

/** The link's token, from an email. */
export class EmailTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto extends EmailTokenDto {
  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(BCRYPT_MAX_PASSWORD_LENGTH)
  password!: string;
}

export class ChangeEmailDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'The current password, to confirm it is you' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BCRYPT_MAX_PASSWORD_LENGTH)
  password!: string;
}
