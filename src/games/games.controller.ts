import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DrawRespondDto } from './dto/draw-respond.dto.js';
import { GameStateDto, toGameStateDto } from './dto/game-state.dto.js';
import { GameSummaryDto, toGameSummaryDto } from './dto/game-summary.dto.js';
import { ListGamesQuery } from './dto/list-games.query.js';
import { MakeMoveDto } from './dto/make-move.dto.js';
import { GamesService } from './games.service.js';

@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  @ApiOperation({
    summary: "List the authenticated user's games (most recent first)",
  })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListGamesQuery,
  ): Promise<GameSummaryDto[]> {
    const games = await this.gamesService.listGamesForUser(user.userId, query);
    return games.map((game) => toGameSummaryDto(game, user.userId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full game state, including move history' })
  async getOne(@Param('id') id: string): Promise<GameStateDto> {
    const game = await this.gamesService.getGameWithMoves(id);
    return toGameStateDto(game);
  }

  @Get(':id/pgn')
  @ApiOperation({ summary: 'Export a game as PGN text' })
  async getPgn(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const pgn = await this.gamesService.getPgnText(id);
    res.setHeader('Content-Type', 'application/x-chess-pgn; charset=utf-8');
    res.send(pgn);
  }

  @Post(':id/moves')
  @ApiOperation({
    summary: 'Submit a move (also available over the realtime gateway)',
  })
  async makeMove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MakeMoveDto,
  ): Promise<GameStateDto> {
    const { game } = await this.gamesService.applyMove(
      id,
      user.userId,
      dto.from,
      dto.to,
      dto.promotion,
    );
    const full = await this.gamesService.getGameWithMoves(game.id);
    return toGameStateDto(full);
  }

  @Post(':id/resign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resign an active game' })
  async resign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<GameStateDto> {
    await this.gamesService.resign(id, user.userId);
    return toGameStateDto(await this.gamesService.getGameWithMoves(id));
  }

  @Post(':id/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abort a game in its first few moves (no rating impact)',
  })
  async abort(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<GameStateDto> {
    await this.gamesService.abort(id, user.userId);
    return toGameStateDto(await this.gamesService.getGameWithMoves(id));
  }

  @Post(':id/draw-offer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Offer (or, if one is pending from the opponent, accept) a draw',
  })
  async offerDraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<GameStateDto> {
    await this.gamesService.offerDraw(id, user.userId);
    return toGameStateDto(await this.gamesService.getGameWithMoves(id));
  }

  @Post(':id/draw-respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept or decline the opponent's draw offer" })
  async respondDraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DrawRespondDto,
  ): Promise<GameStateDto> {
    await this.gamesService.respondDraw(id, user.userId, dto.accept);
    return toGameStateDto(await this.gamesService.getGameWithMoves(id));
  }
}
