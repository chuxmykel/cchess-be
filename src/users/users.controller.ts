import { Body, Controller, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { MeDto, ProfileDto, toMeDto, toProfileDto } from './dto/profile.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated user's own profile" })
  async getMe(@CurrentUser() currentUser: AuthenticatedUser): Promise<MeDto> {
    const user = await this.usersService.findByIdOrThrow(currentUser.userId);
    const ratings = await this.usersService.getRatings(user.id);
    return toMeDto(user, ratings);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated user's profile" })
  async updateMe(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeDto> {
    const user = await this.usersService.updateProfile(currentUser.userId, dto);
    const ratings = await this.usersService.getRatings(user.id);
    return toMeDto(user, ratings);
  }

  @Get(':username')
  @ApiOperation({ summary: "Get a user's public profile by username" })
  async getByUsername(@Param('username') username: string): Promise<ProfileDto> {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const ratings = await this.usersService.getRatings(user.id);
    return toProfileDto(user, ratings);
  }
}
