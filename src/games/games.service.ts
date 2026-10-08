import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { PieceSymbol, Square } from 'chess.js';
import { Repository } from 'typeorm';

import { KeyedMutex } from '../common/keyed-mutex.js';
import type { AppConfig } from '../config/configuration.js';
import { ServerChessEngine } from '../chess/chess-engine.js';
import { classifyTimeControl, incrementMs, toClockMs, type TimeControl } from '../chess/time-control.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/entities/user.entity.js';
import { computeGameEloDeltas } from './elo.js';
import { Game, STARTING_FEN, type GameResult, type GameResultReason, type GameStatus } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { buildPgnText } from './pgn.util.js';

export interface GameEndedEvent {
  game: Game;
}
export interface GameMoveEvent {
  game: Game;
  move: Move;
}
export interface GameDrawOfferEvent {
  game: Game;
}

const GAME_RELATIONS = { white: true, black: true } as const;

@Injectable()
export class GamesService implements OnModuleDestroy {
  private readonly engines = new Map<string, ServerChessEngine>();
  private readonly flagTimers = new Map<string, NodeJS.Timeout>();
  private readonly mutex = new KeyedMutex();

  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(Move) private readonly moves: Repository<Move>,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  onModuleDestroy() {
    for (const timer of this.flagTimers.values()) clearTimeout(timer);
  }

  async createGame(white: User, black: User, tc: TimeControl, rated: boolean): Promise<Game> {
    const gameType = classifyTimeControl(tc);
    const clockMs = toClockMs(tc);

    const game = this.games.create({
      white,
      whiteId: white.id,
      black,
      blackId: black.id,
      minutes: tc.minutes,
      incrementSeconds: tc.incrementSeconds,
      gameType,
      rated: rated && !white.isGuest && !black.isGuest,
      status: 'active',
      result: null,
      resultReason: null,
      fen: STARTING_FEN,
      pgn: '',
      whiteTimeRemainingMs: clockMs,
      blackTimeRemainingMs: clockMs,
      turn: 'w',
      lastMoveAt: null,
      drawOfferedBy: null,
    });
    const saved = await this.games.save(game);
    this.engines.set(saved.id, new ServerChessEngine());
    this.scheduleFlagFall(saved);
    this.events.emit('game.created', { game: saved } satisfies GameEndedEvent);
    return saved;
  }

  async getGameOrThrow(gameId: string): Promise<Game> {
    const game = await this.games.findOne({ where: { id: gameId }, relations: GAME_RELATIONS });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  async getGameWithMoves(gameId: string): Promise<Game> {
    const game = await this.getGameOrThrow(gameId);
    game.moves = await this.moves.find({ where: { gameId }, order: { ply: 'ASC' } });
    return game;
  }

  async getPgnText(gameId: string): Promise<string> {
    const game = await this.getGameWithMoves(gameId);
    return buildPgnText(game, game.moves.map((m) => m.san));
  }

  async listGamesForUser(
    userId: string,
    options: { status?: GameStatus; limit?: number; before?: Date } = {},
  ): Promise<Game[]> {
    const limit = Math.min(options.limit ?? 20, 50);
    const qb = this.games
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.white', 'white')
      .leftJoinAndSelect('g.black', 'black')
      .where('(g.whiteId = :userId OR g.blackId = :userId)', { userId })
      .orderBy('g.createdAt', 'DESC')
      .take(limit);

    if (options.status) qb.andWhere('g.status = :status', { status: options.status });
    if (options.before) qb.andWhere('g.createdAt < :before', { before: options.before });

    return qb.getMany();
  }

  async applyMove(
    gameId: string,
    userId: string,
    from: string,
    to: string,
    promotion?: string,
  ): Promise<{ game: Game; move: Move }> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') throw new ConflictException('Game is not active');

      const color = this.colorOf(game, userId);
      if (game.turn !== color) throw new ConflictException("It's not your turn");

      const now = Date.now();
      const sinceLastMove = game.lastMoveAt ? now - game.lastMoveAt.getTime() : now - game.createdAt.getTime();
      const remainingBefore = color === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;
      const remainingAfterElapsed = remainingBefore - Math.max(sinceLastMove, 0);

      if (remainingAfterElapsed <= 0) {
        await this.finalize(game, color === 'w' ? 'black' : 'white', 'timeout');
        throw new ConflictException('Flagged on time');
      }

      const engine = await this.getOrBuildEngine(game);
      const outcome = engine.attemptMove(from as Square, to as Square, promotion as PieceSymbol | undefined);

      if (outcome.status === 'illegal') throw new BadRequestException('Illegal move');
      if (outcome.status === 'needs-promotion-choice') {
        throw new BadRequestException('This move requires a promotion piece');
      }

      const newRemaining = remainingAfterElapsed + incrementMs({ minutes: game.minutes, incrementSeconds: game.incrementSeconds });
      const ply = engine.history().length;

      const move = await this.moves.save(
        this.moves.create({
          gameId: game.id,
          ply,
          from: outcome.move.from,
          to: outcome.move.to,
          piece: outcome.move.piece,
          color: outcome.move.color,
          san: outcome.move.san,
          captured: outcome.move.captured ?? null,
          promotion: outcome.move.promotion ?? null,
          fenAfter: outcome.fen,
          clockAfterMs: newRemaining,
        }),
      );

      game.fen = outcome.fen;
      game.turn = color === 'w' ? 'b' : 'w';
      game.lastMoveAt = new Date(now);
      game.drawOfferedBy = null;
      if (color === 'w') game.whiteTimeRemainingMs = newRemaining;
      else game.blackTimeRemainingMs = newRemaining;
      await this.games.save(game);

      this.events.emit('game.move', { game, move } satisfies GameMoveEvent);

      const reason = engine.getGameOverReason();
      if (reason) {
        const result: GameResult = reason === 'checkmate' ? (color === 'w' ? 'white' : 'black') : 'draw';
        await this.finalize(game, result, reason);
      } else {
        this.scheduleFlagFall(game);
      }

      return { game, move };
    });
  }

  async resign(gameId: string, userId: string): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') throw new ConflictException('Game is not active');
      const color = this.colorOf(game, userId);
      await this.finalize(game, color === 'w' ? 'black' : 'white', 'resignation');
      return game;
    });
  }

  async offerDraw(gameId: string, userId: string): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') throw new ConflictException('Game is not active');
      const color = this.colorOf(game, userId);
      const otherColor = color === 'w' ? 'b' : 'w';

      if (game.drawOfferedBy === (otherColor === 'w' ? 'white' : 'black')) {
        await this.finalize(game, 'draw', 'draw-agreement');
        return game;
      }

      game.drawOfferedBy = color === 'w' ? 'white' : 'black';
      await this.games.save(game);
      this.events.emit('game.drawOffered', { game } satisfies GameDrawOfferEvent);
      return game;
    });
  }

  async respondDraw(gameId: string, userId: string, accept: boolean): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') throw new ConflictException('Game is not active');
      const color = this.colorOf(game, userId);
      const myOfferLabel = color === 'w' ? 'white' : 'black';

      if (!game.drawOfferedBy || game.drawOfferedBy === myOfferLabel) {
        throw new BadRequestException('No draw offer to respond to');
      }

      if (accept) {
        await this.finalize(game, 'draw', 'draw-agreement');
      } else {
        game.drawOfferedBy = null;
        await this.games.save(game);
        this.events.emit('game.drawDeclined', { game } satisfies GameDrawOfferEvent);
      }
      return game;
    });
  }

  async abort(gameId: string, userId: string): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') throw new ConflictException('Game is not active');
      this.colorOf(game, userId);

      const plyCount = await this.moves.count({ where: { gameId } });
      const abortLimit = this.configService.get('game.abortPlyLimit', { infer: true });
      if (plyCount >= abortLimit) {
        throw new ConflictException('Too late to abort - resign or offer a draw instead');
      }

      await this.finalize(game, null, 'abort', 'aborted');
      return game;
    });
  }

  async forfeitByAbandonment(gameId: string, userId: string): Promise<void> {
    await this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') return;
      const color = this.colorOf(game, userId);
      await this.finalize(game, color === 'w' ? 'black' : 'white', 'abandonment');
    });
  }

  colorOf(game: Game, userId: string): 'w' | 'b' {
    if (game.whiteId === userId) return 'w';
    if (game.blackId === userId) return 'b';
    throw new ForbiddenException('You are not a player in this game');
  }

  private async getOrBuildEngine(game: Game): Promise<ServerChessEngine> {
    const cached = this.engines.get(game.id);
    if (cached) return cached;

    const moveRows = await this.moves.find({ where: { gameId: game.id }, order: { ply: 'ASC' } });
    const engine = new ServerChessEngine();
    for (const row of moveRows) {
      engine.attemptMove(row.from as Square, row.to as Square, (row.promotion ?? undefined) as PieceSymbol | undefined);
    }
    this.engines.set(game.id, engine);
    return engine;
  }

  private scheduleFlagFall(game: Game): void {
    this.clearFlagFallTimer(game.id);
    const remaining = game.turn === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;
    const timer = setTimeout(() => {
      void this.handleFlagFall(game.id);
    }, Math.max(remaining, 0));
    timer.unref?.();
    this.flagTimers.set(game.id, timer);
  }

  private clearFlagFallTimer(gameId: string): void {
    const timer = this.flagTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.flagTimers.delete(gameId);
    }
  }

  private async handleFlagFall(gameId: string): Promise<void> {
    await this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') return;

      const elapsedSinceLastMove = game.lastMoveAt
        ? Date.now() - game.lastMoveAt.getTime()
        : Date.now() - game.createdAt.getTime();
      const remaining = game.turn === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;
      if (remaining - elapsedSinceLastMove > 0) {
        // A move landed concurrently and reset the clock - re-schedule rather than flag.
        this.scheduleFlagFall(game);
        return;
      }

      const loserColor = game.turn;
      await this.finalize(game, loserColor === 'w' ? 'black' : 'white', 'timeout');
    });
  }

  private async finalize(
    game: Game,
    result: GameResult,
    reason: GameResultReason,
    status: GameStatus = 'completed',
  ): Promise<void> {
    this.clearFlagFallTimer(game.id);
    this.engines.delete(game.id);

    game.status = status;
    game.result = result;
    game.resultReason = reason;
    game.endedAt = new Date();

    if (status === 'completed') {
      const moveRows = await this.moves.find({ where: { gameId: game.id }, order: { ply: 'ASC' } });
      game.pgn = buildPgnText(game, moveRows.map((m) => m.san));
    }

    await this.games.save(game);

    if (status === 'completed' && game.rated && result) {
      await this.applyRatingUpdates(game, result);
    }

    this.events.emit('game.ended', { game } satisfies GameEndedEvent);
  }

  private async applyRatingUpdates(game: Game, result: Exclude<GameResult, null>): Promise<void> {
    const [whiteRating, blackRating] = await Promise.all([
      this.usersService.getOrCreateRating(game.whiteId, game.gameType),
      this.usersService.getOrCreateRating(game.blackId, game.gameType),
    ]);

    const { whiteDelta, blackDelta } = computeGameEloDeltas({
      whiteRating: whiteRating.rating,
      whiteGamesPlayed: whiteRating.gamesPlayed,
      blackRating: blackRating.rating,
      blackGamesPlayed: blackRating.gamesPlayed,
      result,
    });

    await Promise.all([
      this.usersService.applyRatingDelta(game.whiteId, game.gameType, whiteDelta),
      this.usersService.applyRatingDelta(game.blackId, game.gameType, blackDelta),
    ]);
  }
}
