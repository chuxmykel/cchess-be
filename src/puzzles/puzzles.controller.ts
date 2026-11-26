import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/types.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  AddPersonalPuzzlesDto,
  NextPuzzleQuery,
  PersonalPuzzleDto,
  PersonalPuzzlesDto,
  PuzzleAttemptDto,
  PuzzleAttemptResultDto,
  PuzzleDto,
  PuzzleRatingDto,
  toPersonalPuzzleDto,
  toPuzzleDto,
} from './dto/puzzle.dto.js';
import { PuzzlesService } from './puzzles.service.js';

@ApiTags('puzzles')
@ApiBearerAuth()
@Controller('puzzles')
export class PuzzlesController {
  constructor(private readonly puzzlesService: PuzzlesService) {}

  @Get('rating')
  @ApiOperation({ summary: 'Your puzzle rating' })
  async rating(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PuzzleRatingDto> {
    const { rating, deviation, attempts } = await this.puzzlesService.ratingOf(
      user.userId,
    );
    return { rating, deviation, attempts };
  }

  @Get('next')
  @ApiOperation({
    summary:
      "A puzzle from the pool near your puzzle rating, of the theme if given, and none you've tried lately",
  })
  async next(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NextPuzzleQuery,
  ): Promise<PuzzleDto> {
    const puzzle = await this.puzzlesService.next(user.userId, query.theme);
    if (!puzzle) throw new NotFoundException('No puzzles left for you here');
    return toPuzzleDto(puzzle);
  }

  // Before ':id/attempt', so 'mine' isn't taken for an id.
  @Get('mine')
  @ApiOperation({
    summary:
      'Your own puzzles - tactics you missed - due now, and how many are being learnt and learnt',
  })
  async mine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PersonalPuzzlesDto> {
    const { due, ...counts } = await this.puzzlesService.mine(user.userId);
    return { due: due.map(toPersonalPuzzleDto), ...counts };
  }

  @Post('mine')
  @ApiOperation({
    summary:
      'Keep tactics you missed in one of your games, from its review - any kept already left as they are',
  })
  async addMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddPersonalPuzzlesDto,
  ): Promise<{ added: number }> {
    const added = await this.puzzlesService.addMine(
      user.userId,
      dto.gameId,
      dto.puzzles,
    );
    return { added };
  }

  @Post('mine/:id/attempt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'A try at one of your own puzzles: on along its schedule if found, back to tomorrow if not',
  })
  async attemptMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PuzzleAttemptDto,
  ): Promise<PersonalPuzzleDto> {
    return toPersonalPuzzleDto(
      await this.puzzlesService.attemptMine(user.userId, id, dto.solved),
    );
  }

  @Post(':id/attempt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A try at a pool puzzle: your puzzle rating before and after',
  })
  attempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PuzzleAttemptDto,
  ): Promise<PuzzleAttemptResultDto> {
    return this.puzzlesService.attempt(user.userId, id, dto.solved);
  }
}
