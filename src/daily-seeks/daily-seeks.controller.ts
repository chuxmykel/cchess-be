import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/types.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { toGameStateDto } from '../games/dto/game-state.dto.js';
import { UsersService } from '../users/users.service.js';
import { DailySeeksService } from './daily-seeks.service.js';
import { CreateDailySeekDto } from './dto/create-daily-seek.dto.js';
import {
  DailySeekDto,
  DailySeekResultDto,
  toDailySeekDto,
} from './dto/daily-seek.dto.js';

@ApiTags('daily-seeks')
@ApiBearerAuth()
@Controller('daily-seeks')
export class DailySeeksController {
  constructor(
    private readonly dailySeeksService: DailySeeksService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Seek a daily game: matched at once with a seek already waiting, or left waiting for one',
  })
  async seek(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateDailySeekDto,
  ): Promise<DailySeekResultDto> {
    const user = await this.usersService.findByIdOrThrow(currentUser.userId);
    const result = await this.dailySeeksService.seek(user, dto);
    return result.status === 'matched'
      ? { status: 'matched', game: toGameStateDto(result.game) }
      : { status: 'queued', seek: toDailySeekDto(result.seek) };
  }

  @Get()
  @ApiOperation({ summary: 'Your daily seeks still waiting, oldest first' })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DailySeekDto[]> {
    const seeks = await this.dailySeeksService.listMine(user.userId);
    return seeks.map(toDailySeekDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a daily seek' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.dailySeeksService.cancel(user.userId, id);
  }
}
