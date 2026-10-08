import { ApiProperty } from '@nestjs/swagger';

import { MeDto } from '../../users/dto/profile.dto.js';

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ type: MeDto })
  user!: MeDto;
}
