import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { PieceSymbol, Square } from 'chess.js';
import { EntityManager, Repository } from 'typeorm';

import { ClusterBus } from '../cluster/cluster-bus.js';
import { isMine, ownerIndex } from '../cluster/cluster.util.js';
import {
  fromWireGame,
  fromWireMove,
  toWireGame,
  toWireMove,
} from '../cluster/cluster-wire.js';
import { GAMES_RPC } from '../cluster/rpc-channels.js';
import { KeyedMutex } from '../common/keyed-mutex.js';
import type { AppConfig } from '../config/configuration.js';
import { ServerChessEngine, type MoveOutcome } from '../chess/chess-engine.js';
import {
  classifyTimeControl,
  incrementMs,
  toClockMs,
  type TimeControl,
} from '../chess/time-control.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { UsersService } from '../users/users.service.js';
import { DEFAULT_GAMES_LIST_LIMIT, MAX_GAMES_LIST_LIMIT } from './dto/list-games.query.js';
import type { User } from '../users/entities/user.entity.js';
import { computeGameEloDeltas } from './elo.js';
import {
  Game,
  STARTING_FEN,
  type GameResult,
  type GameResultReason,
  type GameStatus,
} from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { buildPgnText } from './pgn.util.js';

export interface GameEvent {
  game: Game;
}
export interface GameMoveEvent {
  game: Game;
  move: Move;
}

const GAME_RELATIONS = { white: true, black: true } as const;

@Injectable()
export class GamesService implements OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name);
  private readonly engines = new Map<string, ServerChessEngine>();
  private readonly flagTimers = new Map<string, NodeJS.Timeout>();
  // Live Game rows for every game this worker owns, keyed by id - avoids a
  // redundant SELECT per move (getGameOrThrow below) on top of the already-
  // cached chess.js engine. Safe because isMine(gameId) + the per-game mutex
  // mean exactly one worker ever touches a given game's cache entry, and
  // every mutation below edits this same object in place before saving it -
  // the cache is always current with no separate write-back step needed.
  // Populated on create/first access, evicted in finalize().
  private readonly gameCache = new Map<string, Game>();
  // This worker's own moves for each game it owns, in ply order - the same
  // reasoning as gameCache, needed because getGameWithMoves (the REST
  // read path) would otherwise race applyMove's own DB persist: the
  // broadcast goes out before that write lands (see applyMove), so a REST
  // read triggered by a client reacting to the broadcast can reach the
  // server before the write does. Reading this cache instead of the
  // `moves` table removes that race rather than re-serializing around it.
  private readonly movesCache = new Map<string, Move[]>();
  private readonly mutex = new KeyedMutex();

  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(Move) private readonly moves: Repository<Move>,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly clusterBus: ClusterBus,
  ) {
    this.registerClusterHandlers();
  }

  onModuleDestroy() {
    for (const timer of this.flagTimers.values()) clearTimeout(timer);
  }

  /**
   * Registers what runs on THIS worker when another worker forwards a game
   * mutation here because this worker owns that gameId (see
   * `cluster.util.ts`'s `ownerIndex`). Each handler just re-enters the
   * corresponding public method - `isMine(gameId)` is true by construction
   * once we're here, so that call takes the normal local-execution branch
   * rather than forwarding again.
   */
  private registerClusterHandlers(): void {
    this.clusterBus.onRequest(
      GAMES_RPC.CREATE,
      this.handleCreateRequest.bind(this),
    );
    this.clusterBus.onRequest(
      GAMES_RPC.APPLY_MOVE,
      this.handleApplyMoveRequest.bind(this),
    );
    this.clusterBus.onRequest(
      GAMES_RPC.RESIGN,
      this.handleResignRequest.bind(this),
    );
    this.clusterBus.onRequest(GAMES_RPC.ABORT, this.handleAbortRequest.bind(this));
    this.clusterBus.onRequest(
      GAMES_RPC.OFFER_DRAW,
      this.handleOfferDrawRequest.bind(this),
    );
    this.clusterBus.onRequest(
      GAMES_RPC.RESPOND_DRAW,
      this.handleRespondDrawRequest.bind(this),
    );
    this.clusterBus.onRequest(
      GAMES_RPC.FORFEIT_BY_ABANDONMENT,
      this.handleForfeitByAbandonmentRequest.bind(this),
    );
    this.clusterBus.onRequest(
      GAMES_RPC.GET_WITH_MOVES,
      this.handleGetWithMovesRequest.bind(this),
    );
  }

  private async handleCreateRequest(payload: {
    gameId: string;
    whiteId: string;
    blackId: string;
    tc: TimeControl;
    rated: boolean;
  }) {
    const [white, black] = await Promise.all([
      this.usersService.findByIdOrThrow(payload.whiteId),
      this.usersService.findByIdOrThrow(payload.blackId),
    ]);
    const game = await this.createGameLocal(
      payload.gameId,
      white,
      black,
      payload.tc,
      payload.rated,
    );
    return toWireGame(game);
  }

  private async handleApplyMoveRequest(payload: {
    gameId: string;
    userId: string;
    from: string;
    to: string;
    promotion?: string;
  }) {
    const { game, move } = await this.applyMove(
      payload.gameId,
      payload.userId,
      payload.from,
      payload.to,
      payload.promotion,
    );
    return { game: toWireGame(game), move: toWireMove(move) };
  }

  private async handleResignRequest(payload: {
    gameId: string;
    userId: string;
  }) {
    return toWireGame(await this.resign(payload.gameId, payload.userId));
  }

  private async handleAbortRequest(payload: {
    gameId: string;
    userId: string;
  }) {
    return toWireGame(await this.abort(payload.gameId, payload.userId));
  }

  private async handleOfferDrawRequest(payload: {
    gameId: string;
    userId: string;
  }) {
    return toWireGame(await this.offerDraw(payload.gameId, payload.userId));
  }

  private async handleRespondDrawRequest(payload: {
    gameId: string;
    userId: string;
    accept: boolean;
  }) {
    return toWireGame(
      await this.respondDraw(payload.gameId, payload.userId, payload.accept),
    );
  }

  private async handleForfeitByAbandonmentRequest(payload: {
    gameId: string;
    userId: string;
  }) {
    await this.forfeitByAbandonment(payload.gameId, payload.userId);
    return null;
  }

  private async handleGetWithMovesRequest(payload: { gameId: string }) {
    const game = await this.getGameWithMoves(payload.gameId);
    return { game: toWireGame(game), moves: game.moves.map(toWireMove) };
  }

  /**
   * Shared skeleton behind every ownership-routed method below (mutating or
   * not): if this worker doesn't own `gameId`, forward `payload` over
   * ClusterBus to whichever worker does and translate its wire-format reply
   * with `fromWire`; otherwise run `runLocal` directly.
   */
  private async runOwnershipRouted<TResult, TWire = TResult>(
    gameId: string,
    channel: string,
    payload: unknown,
    fromWire: (wire: TWire) => TResult,
    runLocal: () => Promise<TResult>,
  ): Promise<TResult> {
    if (isMine(gameId)) return runLocal();
    const wire = await this.clusterBus.request<TWire>(
      ownerIndex(gameId),
      channel,
      payload,
    );
    return fromWire(wire);
  }

  async createGame(
    white: User,
    black: User,
    tc: TimeControl,
    rated: boolean,
  ): Promise<Game> {
    const gameId = randomUUID();
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.CREATE,
      { gameId, whiteId: white.id, blackId: black.id, tc, rated },
      fromWireGame,
      this.createGameLocal.bind(this, gameId, white, black, tc, rated),
    );
  }

  private async createGameLocal(
    gameId: string,
    white: User,
    black: User,
    tc: TimeControl,
    rated: boolean,
  ): Promise<Game> {
    const gameType = classifyTimeControl(tc);
    const clockMs = toClockMs(tc);

    const game = this.games.create({
      id: gameId,
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
    this.gameCache.set(saved.id, saved);
    this.movesCache.set(saved.id, []);
    this.scheduleFlagFall(saved);
    this.logger.debug(
      `game ${saved.id} created: ${white.id} vs ${black.id}, ${tc.minutes}+${tc.incrementSeconds} (${gameType}), rated=${saved.rated}`,
    );
    this.events.emit(DOMAIN_EVENTS.GAME_CREATED, {
      game: saved,
    } satisfies GameEvent);
    return saved;
  }

  /**
   * No `white`/`black` relations - this is the lookup used on the hot move-
   * mutation path (applyMove/resign/draw/abort/flag-fall), which never needs
   * the joined User rows (see `colorOf`). Loading them there was pure
   * per-move overhead; `getGameWithMoves` below does its own relation-loaded
   * fetch for the handful of callers (display/PGN export) that actually need
   * the player profiles.
   */
  async getGameOrThrow(gameId: string): Promise<Game> {
    const cached = this.gameCache.get(gameId);
    if (cached) return cached;
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');
    this.gameCache.set(gameId, game);
    return game;
  }

  async getGameWithMoves(gameId: string): Promise<Game> {
    // Ownership-routed like every mutating method below, NOT just a DB
    // read fanned out to whichever worker happens to receive the HTTP
    // request (Node's cluster module round-robins port-sharing across
    // workers regardless of which one owns this gameId). This matters
    // specifically because of getGameWithMovesLocal's cache-first branch:
    // only the owning worker's gameCache/movesCache is guaranteed to
    // reflect a move whose broadcast has already gone out but whose DB
    // write hasn't landed yet (see applyMove) - a different worker falling
    // through to the DB in that same window could race it and miss the
    // very move a client's REST read was triggered by.
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.GET_WITH_MOVES,
      { gameId },
      // eslint-disable-next-line typescript/unbound-method
      this.gameWithMovesFromWire,
      this.getGameWithMovesLocal.bind(this, gameId),
    );
  }

  private gameWithMovesFromWire(wire: {
    game: Record<string, unknown>;
    moves: Record<string, unknown>[];
  }): Game {
    const game = fromWireGame(wire.game);
    game.moves = wire.moves.map(fromWireMove);
    return game;
  }

  private async getGameWithMovesLocal(gameId: string): Promise<Game> {
    // An active game this worker owns: the cache (not the DB) is
    // authoritative, same reasoning as getGameOrThrow.
    const cachedMoves = this.movesCache.get(gameId);
    const cachedGame = this.gameCache.get(gameId);
    if (cachedGame && cachedMoves) {
      const [white, black] = await Promise.all([
        this.usersService.findByIdOrThrow(cachedGame.whiteId),
        this.usersService.findByIdOrThrow(cachedGame.blackId),
      ]);
      // eslint-disable-next-line typescript/no-misused-spread -- deliberate: a plain DTO-shaped copy, same reasoning as cluster-wire.ts's toWireGame.
      return { ...cachedGame, white, black, moves: cachedMoves };
    }
    const game = await this.games.findOne({
      where: { id: gameId },
      relations: GAME_RELATIONS,
    });
    if (!game) throw new NotFoundException('Game not found');
    game.moves = await this.moves.find({
      where: { gameId },
      order: { ply: 'ASC' },
    });
    return game;
  }

  async getPgnText(gameId: string): Promise<string> {
    const game = await this.getGameWithMoves(gameId);
    return buildPgnText(
      game,
      {
        whiteUsername: game.white.username,
        blackUsername: game.black.username,
      },
      game.moves.map((m) => m.san),
    );
  }

  async listGamesForUser(
    userId: string,
    options: { status?: GameStatus; limit?: number; before?: Date } = {},
  ): Promise<Game[]> {
    const limit = Math.min(
      options.limit ?? DEFAULT_GAMES_LIST_LIMIT,
      MAX_GAMES_LIST_LIMIT,
    );
    const qb = this.games
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.white', 'white')
      .leftJoinAndSelect('g.black', 'black')
      .where('(g.whiteId = :userId OR g.blackId = :userId)', { userId })
      .andWhere('g.deletedAt IS NULL')
      .orderBy('g.createdAt', 'DESC')
      .take(limit);

    if (options.status)
      qb.andWhere('g.status = :status', { status: options.status });
    if (options.before)
      qb.andWhere('g.createdAt < :before', { before: options.before });

    return qb.getMany();
  }

  async applyMove(
    gameId: string,
    userId: string,
    from: string,
    to: string,
    promotion?: string,
  ): Promise<{ game: Game; move: Move }> {
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.APPLY_MOVE,
      { gameId, userId, from, to, promotion },
      // eslint-disable-next-line typescript/unbound-method
      this.applyMoveFromWire,
      this.applyMoveLocal.bind(this, gameId, userId, from, to, promotion),
    );
  }

  private applyMoveFromWire(wire: {
    game: Record<string, unknown>;
    move: Record<string, unknown>;
  }): { game: Game; move: Move } {
    return { game: fromWireGame(wire.game), move: fromWireMove(wire.move) };
  }

  private async applyMoveLocal(
    gameId: string,
    userId: string,
    from: string,
    to: string,
    promotion?: string,
  ): Promise<{ game: Game; move: Move }> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      this.assertGameActive(game);
      // colorOf is called between these two guards deliberately - it's
      // what throws Forbidden for a non-player, and that should still lose
      // to "game is not active" rather than to "it's not your turn" if
      // someone who isn't even in this game somehow calls it on a finished
      // one.
      const color = this.colorOf(game, userId);
      this.assertPlayersTurn(game, color);

      const now = Date.now();
      const remainingAfterElapsed = await this.enforceClock(game, color, now);

      const engine = await this.getOrBuildEngine(game);
      const outcome = this.attemptMoveOrThrow(engine, from, to, promotion);

      const ply = engine.history().length;
      const newRemaining =
        remainingAfterElapsed +
        incrementMs({
          minutes: game.minutes,
          incrementSeconds: game.incrementSeconds,
        });

      this.applyMoveToGameState(game, outcome, color, newRemaining, now);
      const move = this.buildMoveEntity(game, outcome, ply, newRemaining, now);
      this.cacheMove(game.id, move);

      // Broadcast before persisting, not after - EventEmitter2 dispatches
      // this synchronously into RealtimeGateway's listener, whose
      // socket.io emit() writes to the OS socket buffer immediately, well
      // before the `await` below even starts. Moving the DB write after
      // this point is what cuts it out of the player-perceived latency;
      // applyMove() itself still doesn't resolve until the write completes
      // (same guarantee every caller already had), so there's no read-
      // after-write gap and no detached-write error handling to add.
      this.events.emit(DOMAIN_EVENTS.GAME_MOVE, {
        game,
        move,
      } satisfies GameMoveEvent);

      await this.persistMoveAndGame(move, game);
      await this.finalizeIfGameOver(game, outcome, color);

      return { game, move };
    });
  }

  private assertGameActive(game: Game): void {
    if (game.status !== 'active')
      throw new ConflictException('Game is not active');
  }

  private assertPlayersTurn(game: Game, color: 'w' | 'b'): void {
    if (game.turn !== color) throw new ConflictException("It's not your turn");
  }

  /** Deducts elapsed time from the mover's clock; if that leaves none,
   * finalizes the game as a timeout loss and throws - never applies a move
   * submitted after the flag already fell. Returns the mover's remaining
   * time immediately before this move; the caller adds the incrementMs
   * once the move itself is known to be legal. */
  private async enforceClock(
    game: Game,
    color: 'w' | 'b',
    now: number,
  ): Promise<number> {
    const sinceLastMove = game.lastMoveAt
      ? now - game.lastMoveAt.getTime()
      : now - game.createdAt.getTime();
    const remainingBefore =
      color === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;
    const remainingAfterElapsed = remainingBefore - Math.max(sinceLastMove, 0);

    if (remainingAfterElapsed <= 0) {
      await this.finalize(game, color === 'w' ? 'black' : 'white', 'timeout');
      throw new ConflictException('Flagged on time');
    }
    return remainingAfterElapsed;
  }

  private attemptMoveOrThrow(
    engine: ServerChessEngine,
    from: string,
    to: string,
    promotion?: string,
  ): Extract<MoveOutcome, { status: 'ok' }> {
    const outcome = engine.attemptMove(
      from as Square,
      to as Square,
      promotion as PieceSymbol | undefined,
    );
    if (outcome.status === 'illegal')
      throw new BadRequestException('Illegal move');
    if (outcome.status === 'needs-promotion-choice') {
      throw new BadRequestException('This move requires a promotion piece');
    }
    return outcome;
  }

  private applyMoveToGameState(
    game: Game,
    outcome: Extract<MoveOutcome, { status: 'ok' }>,
    color: 'w' | 'b',
    newRemaining: number,
    now: number,
  ): void {
    game.fen = outcome.fen;
    game.turn = color === 'w' ? 'b' : 'w';
    game.lastMoveAt = new Date(now);
    game.drawOfferedBy = null;
    if (color === 'w') game.whiteTimeRemainingMs = newRemaining;
    else game.blackTimeRemainingMs = newRemaining;
  }

  private buildMoveEntity(
    game: Game,
    outcome: Extract<MoveOutcome, { status: 'ok' }>,
    ply: number,
    newRemaining: number,
    now: number,
  ): Move {
    // id generated here (not left to the DB), same as createGameLocal
    // already does for Game.id - nothing the broadcast below sends
    // depends on this write having landed.
    return this.moves.create({
      id: randomUUID(),
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
      createdAt: new Date(now),
    });
  }

  private cacheMove(gameId: string, move: Move): void {
    // See movesCache's own comment: this is what makes a REST read right
    // after the broadcast consistent instead of racing the DB write in
    // persistMoveAndGame below. Cache miss here (an active, owned game
    // with no entry) only happens after a cold restart losing all
    // in-memory state - fall back to appending to an empty array so a
    // move is never silently dropped from the cache.
    this.movesCache.set(gameId, [...(this.movesCache.get(gameId) ?? []), move]);
  }

  private async persistMoveAndGame(move: Move, game: Game): Promise<void> {
    // One transaction (one commit) for both writes instead of two - under
    // WAL this roughly halves the fsync-equivalent overhead per move.
    //
    // Raw parameterized SQL, not manager.save()/QueryBuilder - profiling
    // under load found the query builder regex-templating the full SQL
    // text on every call was the largest CPU cost on this path, bigger
    // than chess.js's own move validation. Both statements are fixed
    // shape, so there's nothing per-call for a query builder to buy us.
    await this.games.manager.transaction(async (manager) => {
      await this.insertMoveRaw(manager, move);
      await this.updateGameRaw(manager, game);
    });
  }

  private async finalizeIfGameOver(
    game: Game,
    outcome: Extract<MoveOutcome, { status: 'ok' }>,
    color: 'w' | 'b',
  ): Promise<void> {
    const reason = outcome.gameOverReason;
    if (reason) {
      const result: GameResult =
        reason === 'checkmate' ? (color === 'w' ? 'white' : 'black') : 'draw';
      await this.finalize(game, result, reason);
    } else {
      this.scheduleFlagFall(game);
    }
  }

  private async insertMoveRaw(
    manager: EntityManager,
    move: Move,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO moves
         (id, "gameId", ply, "from", "to", piece, color, san, captured, promotion, "fenAfter", "clockAfterMs", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        move.id,
        move.gameId,
        move.ply,
        move.from,
        move.to,
        move.piece,
        move.color,
        move.san,
        move.captured,
        move.promotion,
        move.fenAfter,
        move.clockAfterMs,
        move.createdAt,
      ],
    );
  }

  private async updateGameRaw(
    manager: EntityManager,
    game: Game,
  ): Promise<void> {
    await manager.query(
      `UPDATE games
       SET fen = $1, turn = $2, "lastMoveAt" = $3, "drawOfferedBy" = $4,
           "whiteTimeRemainingMs" = $5, "blackTimeRemainingMs" = $6
       WHERE id = $7`,
      [
        game.fen,
        game.turn,
        game.lastMoveAt,
        game.drawOfferedBy,
        game.whiteTimeRemainingMs,
        game.blackTimeRemainingMs,
        game.id,
      ],
    );
  }

  async resign(gameId: string, userId: string): Promise<Game> {
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.RESIGN,
      { gameId, userId },
      fromWireGame,
      this.resignLocal.bind(this, gameId, userId),
    );
  }

  private resignLocal(gameId: string, userId: string): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active')
        throw new ConflictException('Game is not active');
      const color = this.colorOf(game, userId);
      await this.finalize(
        game,
        color === 'w' ? 'black' : 'white',
        'resignation',
      );
      return game;
    });
  }

  async offerDraw(gameId: string, userId: string): Promise<Game> {
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.OFFER_DRAW,
      { gameId, userId },
      fromWireGame,
      this.offerDrawLocal.bind(this, gameId, userId),
    );
  }

  private offerDrawLocal(gameId: string, userId: string): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active')
        throw new ConflictException('Game is not active');
      const color = this.colorOf(game, userId);
      const otherColor = color === 'w' ? 'b' : 'w';

      if (game.drawOfferedBy === (otherColor === 'w' ? 'white' : 'black')) {
        await this.finalize(game, 'draw', 'draw-agreement');
        return game;
      }

      game.drawOfferedBy = color === 'w' ? 'white' : 'black';
      await this.games.save(game);
      this.events.emit(DOMAIN_EVENTS.GAME_DRAW_OFFERED, {
        game,
      } satisfies GameEvent);
      return game;
    });
  }

  async respondDraw(
    gameId: string,
    userId: string,
    accept: boolean,
  ): Promise<Game> {
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.RESPOND_DRAW,
      { gameId, userId, accept },
      fromWireGame,
      this.respondDrawLocal.bind(this, gameId, userId, accept),
    );
  }

  private respondDrawLocal(
    gameId: string,
    userId: string,
    accept: boolean,
  ): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active')
        throw new ConflictException('Game is not active');
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
        this.events.emit(DOMAIN_EVENTS.GAME_DRAW_DECLINED, {
          game,
        } satisfies GameEvent);
      }
      return game;
    });
  }

  async abort(gameId: string, userId: string): Promise<Game> {
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.ABORT,
      { gameId, userId },
      fromWireGame,
      this.abortLocal.bind(this, gameId, userId),
    );
  }

  private abortLocal(gameId: string, userId: string): Promise<Game> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active')
        throw new ConflictException('Game is not active');
      this.colorOf(game, userId);

      // The cached engine's own history, not a `moves` table count - a
      // move's row is now persisted off the response path (see applyMove),
      // so a DB count here could race a move whose row hasn't landed yet
      // and under-count. The engine cache is already the authoritative ply
      // count for this worker regardless of persistence timing (finalize()
      // leans on the same cache for the same reason).
      const plyCount = (await this.getOrBuildEngine(game)).history().length;
      const abortLimit = this.configService.get('game.abortPlyLimit', {
        infer: true,
      });
      if (plyCount >= abortLimit) {
        throw new ConflictException(
          'Too late to abort - resign or offer a draw instead',
        );
      }

      await this.finalize(game, null, 'abort', 'aborted');
      return game;
    });
  }

  async forfeitByAbandonment(gameId: string, userId: string): Promise<void> {
    return this.runOwnershipRouted(
      gameId,
      GAMES_RPC.FORFEIT_BY_ABANDONMENT,
      { gameId, userId },
      // eslint-disable-next-line typescript/unbound-method
      this.wireToVoid,
      this.forfeitByAbandonmentLocal.bind(this, gameId, userId),
    );
  }

  private wireToVoid(): undefined {
    return undefined;
  }

  private forfeitByAbandonmentLocal(gameId: string, userId: string): Promise<void> {
    return this.mutex.runExclusive(gameId, async () => {
      const game = await this.getGameOrThrow(gameId);
      if (game.status !== 'active') return;
      const color = this.colorOf(game, userId);
      await this.finalize(
        game,
        color === 'w' ? 'black' : 'white',
        'abandonment',
      );
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

    const moveRows = await this.moves.find({
      where: { gameId: game.id },
      order: { ply: 'ASC' },
    });
    const engine = new ServerChessEngine();
    for (const row of moveRows) {
      engine.attemptMove(
        row.from as Square,
        row.to as Square,
        (row.promotion ?? undefined) as PieceSymbol | undefined,
      );
    }
    this.engines.set(game.id, engine);
    return engine;
  }

  private scheduleFlagFall(game: Game): void {
    this.clearFlagFallTimer(game.id);
    const remaining =
      game.turn === 'w' ? game.whiteTimeRemainingMs : game.blackTimeRemainingMs;
    const timer = setTimeout(
      () => {
        void this.handleFlagFall(game.id);
      },
      Math.max(remaining, 0),
    );
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
      const remaining =
        game.turn === 'w'
          ? game.whiteTimeRemainingMs
          : game.blackTimeRemainingMs;
      if (remaining - elapsedSinceLastMove > 0) {
        // A move landed concurrently and reset the clock - re-schedule rather than flag.
        this.scheduleFlagFall(game);
        return;
      }

      const loserColor = game.turn;
      await this.finalize(
        game,
        loserColor === 'w' ? 'black' : 'white',
        'timeout',
      );
    });
  }

  private async finalize(
    game: Game,
    result: GameResult,
    reason: GameResultReason,
    status: GameStatus = 'completed',
  ): Promise<void> {
    // The one place every game's outcome passes through, regardless of how
    // it got here (checkmate, resignation, timeout, abandonment, draw,
    // abort) - cheap visibility into why/how games are actually ending
    // without needing a DB query.
    this.logger.debug(
      `game ${game.id} ending: status=${status} result=${result} reason=${reason}`,
    );
    this.clearFlagFallTimer(game.id);
    const cachedEngine = this.engines.get(game.id);
    this.engines.delete(game.id);
    this.gameCache.delete(game.id);
    this.movesCache.delete(game.id);

    game.status = status;
    game.result = result;
    game.resultReason = reason;
    game.endedAt = new Date();

    // Needed below regardless of status: the 'game.ended' event (which fires
    // either way) feeds a GameStateDto that always wants both players, and
    // `game` itself never carries them here (see getGameOrThrow). Two
    // PK-indexed lookups once per finished game, vs. the two-join query this
    // used to cost on every single move.
    if (!game.white || !game.black) {
      const [white, black] = await Promise.all([
        this.usersService.findByIdOrThrow(game.whiteId),
        this.usersService.findByIdOrThrow(game.blackId),
      ]);
      game.white = white;
      game.black = black;
    }

    if (status === 'completed') {
      // The move-by-move SAN sequence already lives in the cached engine
      // (chess.js's own history) - reuse it instead of re-reading every
      // Move row back out of the database. Falls back to a DB read only if
      // the cache was somehow cold (e.g. a resign immediately post-restart).
      const sans = cachedEngine
        ? cachedEngine.history()
        : (
            await this.moves.find({
              where: { gameId: game.id },
              order: { ply: 'ASC' },
            })
          ).map((m) => m.san);
      game.pgn = buildPgnText(
        game,
        {
          whiteUsername: game.white.username,
          blackUsername: game.black.username,
        },
        sans,
      );
    }

    await this.games.save(game);

    if (status === 'completed' && game.rated && result) {
      await this.applyRatingUpdates(game, result);
    }

    this.events.emit(DOMAIN_EVENTS.GAME_ENDED, { game } satisfies GameEvent);
  }

  private async applyRatingUpdates(
    game: Game,
    result: Exclude<GameResult, null>,
  ): Promise<void> {
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
      this.usersService.applyRatingDelta(
        game.whiteId,
        game.gameType,
        whiteDelta,
      ),
      this.usersService.applyRatingDelta(
        game.blackId,
        game.gameType,
        blackDelta,
      ),
    ]);
  }
}
