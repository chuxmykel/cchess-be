import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { DOMAIN_EVENTS } from '../common/events.js';
import { Game, type Side } from './entities/game.entity.js';
import { GamesService } from './games.service.js';
import { seriesForRematchOf } from './rematch-series.js';

export interface RematchEvent {
  game: Game;
  /** Who offered, declined or withdrew. */
  by: Side;
}

/**
 * Rematches: once a game is over - played out, not aborted - either player
 * can offer to play again with colors swapped; when both have offered, the
 * rematch starts, keeping the series' running score. Works on finished games only, read straight
 * from the database - GamesService's in-memory cache is for games in
 * progress.
 */
@Injectable()
export class RematchService {
  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    private readonly gamesService: GamesService,
    private readonly events: EventEmitter2,
  ) {}

  /** Offers a rematch - or, when the opponent already has, starts it. */
  async offer(gameId: string, userId: string): Promise<Game | null> {
    const game = await this.finishedGameOrThrow(gameId);
    const mine = this.sideOf(game, userId);
    const theirs: Side = mine === 'white' ? 'black' : 'white';
    if (game.rematchOfferedBy === theirs) return this.start(game, theirs);
    if (game.rematchOfferedBy === mine) return null;

    await this.gamesService.assertNotPlaying(userId);
    const { affected } = await this.games.update(
      { id: gameId, rematchGameId: IsNull() },
      { rematchOfferedBy: mine },
    );
    if (!affected) throw new ConflictException('Rematch already started');
    game.rematchOfferedBy = mine;
    this.events.emit(DOMAIN_EVENTS.GAME_REMATCH_OFFERED, {
      game,
      by: mine,
    } satisfies RematchEvent);
    return null;
  }

  /** Declines the opponent's offer, or withdraws your own. */
  async decline(gameId: string, userId: string): Promise<void> {
    const game = await this.finishedGameOrThrow(gameId);
    const mine = this.sideOf(game, userId);
    if (!game.rematchOfferedBy) {
      throw new BadRequestException('No rematch offer to answer');
    }
    await this.games.update(
      { id: gameId, rematchGameId: IsNull() },
      { rematchOfferedBy: null },
    );
    game.rematchOfferedBy = null;
    this.events.emit(DOMAIN_EVENTS.GAME_REMATCH_DECLINED, {
      game,
      by: mine,
    } satisfies RematchEvent);
  }

  private async start(game: Game, offeredBy: Side): Promise<Game> {
    await this.gamesService.assertNotPlaying(game.whiteId);
    await this.gamesService.assertNotPlaying(game.blackId);
    // Only one acceptance may start the rematch: the first to clear the
    // offer wins, and a second, racing one finds it gone.
    const { affected } = await this.games.update(
      { id: game.id, rematchOfferedBy: offeredBy, rematchGameId: IsNull() },
      { rematchOfferedBy: null },
    );
    if (!affected) throw new ConflictException('Rematch already started');

    const rematch = await this.gamesService.createGame(
      game.black,
      game.white,
      {
        initialSeconds: game.initialSeconds,
        incrementSeconds: game.incrementSeconds,
      },
      game.rated,
      seriesForRematchOf(game),
    );
    await this.games.update(game.id, { rematchGameId: rematch.id });
    return rematch;
  }

  private async finishedGameOrThrow(gameId: string): Promise<Game> {
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: { white: true, black: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    if (game.status === 'active') {
      throw new ConflictException('The game is still being played');
    }
    if (game.status === 'aborted') {
      throw new ConflictException("An aborted game can't be rematched");
    }
    if (game.rematchGameId) {
      throw new ConflictException('Rematch already started');
    }
    return game;
  }

  private sideOf(game: Game, userId: string): Side {
    if (game.whiteId === userId) return 'white';
    if (game.blackId === userId) return 'black';
    throw new ForbiddenException('You are not playing in this game');
  }
}
