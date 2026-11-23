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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/types.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { LoopbackOnlyGuard } from '../maintenance/loopback-only.guard.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import type { ReportStatus } from './entities/report.entity.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiBearerAuth()
  @Post('reports')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Report a player - for a game chat message, a direct message, or themselves',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<void> {
    await this.reportsService.create(user.userId, dto);
  }

  // Moderation: from the api's own machine only, like maintenance's.

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Get('internal/reports')
  @ApiExcludeEndpoint()
  async list(@Query('status') status?: ReportStatus) {
    return (await this.reportsService.list(status)).map((report) => ({
      id: report.id,
      createdAt: report.createdAt,
      reporter: report.reporter.username,
      reported: report.reportedUser.username,
      reason: report.reason,
      details: report.details,
      gameId: report.gameId,
      messageId: report.messageId,
      messageText: report.messageText,
      status: report.status,
    }));
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Post('internal/reports/:id/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async resolve(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.reportsService.resolve(id);
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Post('internal/users/:username/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async suspend(@Param('username') username: string): Promise<void> {
    await this.reportsService.suspend(username);
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Post('internal/users/:username/unsuspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async unsuspend(@Param('username') username: string): Promise<void> {
    await this.reportsService.unsuspend(username);
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Delete('internal/game-chat/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async deleteChatMessage(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.reportsService.deleteMessage('game-chat', id);
  }

  @Public()
  @UseGuards(LoopbackOnlyGuard)
  @Delete('internal/direct-messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async deleteDirectMessage(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.reportsService.deleteMessage('direct-message', id);
  }
}
