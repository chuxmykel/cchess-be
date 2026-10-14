import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Username or email' })
  @IsString()
  usernameOrEmail!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
