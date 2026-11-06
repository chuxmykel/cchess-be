import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RefreshToken } from '../auth/entities/refresh-token.entity.js';
import { ClusterModule } from '../cluster/cluster.module.js';
import { DOMAIN_EVENTS } from '../common/events.js';
import { requireEnv } from '../common/require-env.js';
import {
  Rating,
  STARTING_DEVIATION,
  STARTING_RATING,
  STARTING_VOLATILITY,
} from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { ConditionalMovesService } from './conditional-moves.service.js';
import { ConditionalMoveSet } from './entities/conditional-move-set.entity.js';
import { Game } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { MAX_ACTIVE_DAILY_GAMES } from './daily.js';
import { GameEvent, GamesService } from './games.service.js';
import { rateGame } from './glicko2.js';
import { truncateAllTables } from '../../test/utils/db.js';
import { TimeControl, toClockMs } from '../chess/time-control.js';

async function buildModule(gameConfig: Record<string, unknown> = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            game: {
              disconnectGraceMs: 60_000,
              abortPlyLimit: 2,
              ...gameConfig,
            },
            jwt: { refreshSecret: 'test' },
          }),
        ],
      }),
      EventEmitterModule.forRoot(),
      ClusterModule,
      // These DB_* reads resolve to the TEST_DB_* values from .env -
      // vitest.config.ts injects them under the DB_* names before this file
      // runs (see its own `env` block) - not a fallback-bearing default; see
      // src/database/data-source.ts for why these have no fallback.
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: requireEnv('DB_HOST'),
        port: Number(requireEnv('DB_PORT')),
        username: requireEnv('DB_USERNAME'),
        password: requireEnv('DB_PASSWORD'),
        database: requireEnv('DB_NAME'),
        entities: [User, Rating, RefreshToken, Game, Move, ConditionalMoveSet],
        // Schema already applied via real migrations (see
        // src/database/migrations) - this test module only registers a
        // subset of entities, so synchronize here would be misleading as
        // well as unnecessary.
        synchronize: false,
      }),
      TypeOrmModule.forFeature([User, Rating, Game, Move, ConditionalMoveSet]),
    ],
    providers: [GamesService, UsersService, ConditionalMovesService],
  }).compile();

  await truncateAllTables(moduleRef.get(DataSource));

  return {
    gamesService: moduleRef.get(GamesService),
    conditionalMoves: moduleRef.get(ConditionalMovesService),
    usersService: moduleRef.get(UsersService),
    ratingsRepo: moduleRef.get<Repository<Rating>>(getRepositoryToken(Rating)),
    eventEmitter: moduleRef.get(EventEmitter2),
    moduleRef,
  };
}

/** Resolves once GamesService's own 'game.ended' event fires for this game
 * id - the real signal finalize() emits only after both its DB save and
 * applyRatingUpdates() have completed, same as RealtimeGateway relies on.
 **/
function waitForGameEnded(
  eventEmitter: EventEmitter2,
  gameId: string,
): Promise<GameEvent> {
  return new Promise((resolve) => {
    const handler = (event: GameEvent) => {
      if (event.game.id !== gameId) return;
      eventEmitter.off(DOMAIN_EVENTS.GAME_ENDED, handler);
      resolve(event);
    };
    eventEmitter.on(DOMAIN_EVENTS.GAME_ENDED, handler);
  });
}

describe('GamesService', () => {
  let ctx: Awaited<ReturnType<typeof buildModule>>;

  beforeEach(async () => {
    ctx = await buildModule();
  });

  afterEach(async () => {
    await ctx.moduleRef.close();
  });

  async function makeUser(username: string) {
    return ctx.usersService.createRegisteredUser({
      username,
      email: `${username}@example.com`,
      passwordHash: 'hash',
    });
  }

  it('creates a game with full clocks and the right gameType classification', async () => {
    const white = await makeUser('white1');
    const black = await makeUser('black1');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );

    expect(game.gameType).toBe('blitz');
    expect(game.whiteTimeRemainingMs).toBe(5 * 60 * 1000);
    expect(game.blackTimeRemainingMs).toBe(5 * 60 * 1000);
    expect(game.status).toBe('active');
    expect(game.turn).toBe('w');
  });

  it('applies a legal move and switches turn, rejects illegal moves and wrong-turn moves', async () => {
    const white = await makeUser('white2');
    const black = await makeUser('black2');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );

    const { move } = await ctx.gamesService.applyMove(
      game.id,
      white.id,
      'e2',
      'e4',
    );
    expect(move.san).toBe('e4');

    await expect(
      ctx.gamesService.applyMove(game.id, white.id, 'd2', 'd4'),
    ).rejects.toThrow('not your turn');
    await expect(
      ctx.gamesService.applyMove(game.id, black.id, 'a7', 'a4'),
    ).rejects.toThrow('Illegal move');
  });

  function newPlayerRating() {
    return {
      rating: STARTING_RATING,
      deviation: STARTING_DEVIATION,
      volatility: STARTING_VOLATILITY,
    };
  }

  async function blitzRating(userId: string) {
    return (await ctx.usersService.getRatings(userId)).find(
      (r) => r.category === 'blitz',
    )!;
  }

  async function playFoolsMate(
    gameId: string,
    whiteId: string,
    blackId: string,
  ) {
    await ctx.gamesService.applyMove(gameId, whiteId, 'f2', 'f3');
    await ctx.gamesService.applyMove(gameId, blackId, 'e7', 'e5');
    await ctx.gamesService.applyMove(gameId, whiteId, 'g2', 'g4');
    return ctx.gamesService.applyMove(gameId, blackId, 'd8', 'h4');
  }

  it('ends the game and updates both Glicko-2 ratings on checkmate', async () => {
    const white = await makeUser('white3');
    const black = await makeUser('black3');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );

    const { game: finalGame } = await playFoolsMate(
      game.id,
      white.id,
      black.id,
    );

    expect(finalGame.status).toBe('completed');
    expect(finalGame.result).toBe('black');
    expect(finalGame.resultReason).toBe('checkmate');

    const expectedWinner = rateGame(newPlayerRating(), newPlayerRating(), 1, 1);
    const expectedLoser = rateGame(newPlayerRating(), newPlayerRating(), 0, 1);
    const blackBlitz = await blitzRating(black.id);
    const whiteBlitz = await blitzRating(white.id);
    expect(blackBlitz.rating).toBeCloseTo(expectedWinner.rating, 6);
    expect(blackBlitz.deviation).toBeCloseTo(expectedWinner.deviation, 6);
    expect(blackBlitz.volatility).toBeCloseTo(expectedWinner.volatility, 9);
    expect(whiteBlitz.rating).toBeCloseTo(expectedLoser.rating, 6);
    expect(blackBlitz.gamesPlayed).toBe(1);
    expect(whiteBlitz.gamesPlayed).toBe(1);
    expect(blackBlitz.lastRatedAt).not.toBeNull();
  });

  it('moves a settled rating far less than a new one', async () => {
    const settledWhite = await makeUser('white3b');
    const settledBlack = await makeUser('black3b');
    for (const user of [settledWhite, settledBlack]) {
      await ctx.ratingsRepo.update(
        { userId: user.id, category: 'blitz' },
        { deviation: 60, lastRatedAt: new Date() },
      );
    }
    const newWhite = await makeUser('white3c');
    const newBlack = await makeUser('black3c');

    for (const [white, black] of [
      [settledWhite, settledBlack],
      [newWhite, newBlack],
    ]) {
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      await playFoolsMate(game.id, white.id, black.id);
    }

    const settledGain = (await blitzRating(settledBlack.id)).rating - 1500;
    const newGain = (await blitzRating(newBlack.id)).rating - 1500;
    expect(settledGain).toBeGreaterThan(0);
    expect(settledGain).toBeLessThan(newGain / 4);
  });

  it("grows a returning player's deviation for the time since their last rated game", async () => {
    const regular = await makeUser('white3d');
    const returning = await makeUser('white3e');
    const opponentOfRegular = await makeUser('black3d');
    const opponentOfReturning = await makeUser('black3e');
    const aYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    for (const [user, lastRatedAt] of [
      [regular, new Date()],
      [returning, aYearAgo],
    ] as const) {
      await ctx.ratingsRepo.update(
        { userId: user.id, category: 'blitz' },
        { deviation: 60, lastRatedAt },
      );
    }

    for (const [white, black] of [
      [regular, opponentOfRegular],
      [returning, opponentOfReturning],
    ]) {
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      await playFoolsMate(game.id, white.id, black.id);
    }

    const regularLoss = 1500 - (await blitzRating(regular.id)).rating;
    const returningLoss = 1500 - (await blitzRating(returning.id)).rating;
    expect(returningLoss).toBeGreaterThan(regularLoss);
  });

  it('resigns in favor of the opponent', async () => {
    const white = await makeUser('white4');
    const black = await makeUser('black4');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );

    await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');

    const resigned = await ctx.gamesService.resign(game.id, white.id);
    expect(resigned.status).toBe('completed');
    expect(resigned.result).toBe('black');
    expect(resigned.resultReason).toBe('resignation');
  });

  it('handles a draw offer and acceptance', async () => {
    const white = await makeUser('white5');
    const black = await makeUser('black5');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );

    await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');

    await ctx.gamesService.offerDraw(game.id, white.id);
    await expect(
      ctx.gamesService.respondDraw(game.id, white.id, true),
    ).rejects.toThrow();

    const result = await ctx.gamesService.respondDraw(game.id, black.id, true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('draw');
    expect(result.resultReason).toBe('draw-agreement');
  });

  it('refuses a resignation or draw offer before both sides have moved', async () => {
    const white = await makeUser('white7');
    const black = await makeUser('black7');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );
    await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');

    await expect(ctx.gamesService.resign(game.id, black.id)).rejects.toThrow(
      'Too early to resign - abort the game instead',
    );
    await expect(ctx.gamesService.offerDraw(game.id, white.id)).rejects.toThrow(
      'Too early to offer a draw - abort the game instead',
    );

    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
    const resigned = await ctx.gamesService.resign(game.id, black.id);
    expect(resigned.resultReason).toBe('resignation');
  });

  it('allows abort within the ply limit but not after', async () => {
    const white = await makeUser('white6');
    const black = await makeUser('black6');

    // 1 ply played, below the configured abortPlyLimit of 2 - still abortable.
    const withinLimit = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );
    await ctx.gamesService.applyMove(withinLimit.id, white.id, 'e2', 'e4');
    const aborted = await ctx.gamesService.abort(withinLimit.id, black.id);
    expect(aborted.status).toBe('aborted');

    // 2 plies played, at the limit - no longer abortable.
    const pastLimit = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );
    await ctx.gamesService.applyMove(pastLimit.id, white.id, 'e2', 'e4');
    await ctx.gamesService.applyMove(pastLimit.id, black.id, 'e7', 'e5');
    await expect(
      ctx.gamesService.abort(pastLimit.id, white.id),
    ).rejects.toThrow('Too late to abort');
  });

  it('aborts a fresh game with no rating impact', async () => {
    const white = await makeUser('white7');
    const black = await makeUser('black7');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );

    const aborted = await ctx.gamesService.abort(game.id, black.id);
    expect(aborted.status).toBe('aborted');

    const whiteRatings = await ctx.usersService.getRatings(white.id);
    expect(whiteRatings.find((r) => r.category === 'blitz')!.gamesPlayed).toBe(
      0,
    );
  });

  it('flags a player on time, persisting their zeroed clock and updating ratings', async () => {
    const white = await makeUser('white8');
    const black = await makeUser('black8');
    // The shortest clock there is, so the test is fast, and non-zero so the
    // assertions below can pin an exact stale value that would otherwise
    // leak through unzeroed on an unfixed handleFlagFall.
    const timeControl: TimeControl = {
      initialSeconds: 1,
      incrementSeconds: 0,
    };
    const game = await ctx.gamesService.createGame(
      white,
      black,
      timeControl,
      true,
    );
    const gameEnded = waitForGameEnded(ctx.eventEmitter, game.id);
    await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');

    const { game: finalGame } = await gameEnded;

    expect(finalGame.status).toBe('completed');
    expect(finalGame.result).toBe('black');
    expect(finalGame.resultReason).toBe('timeout');
    expect(finalGame.whiteTimeRemainingMs).toBe(0);
    expect(finalGame.blackTimeRemainingMs).toBe(toClockMs(timeControl));

    const blackRating = await ctx.ratingsRepo.findOne({
      where: { userId: black.id, category: 'bullet' },
    });
    expect(blackRating?.gamesPlayed).toBe(1);
  });

  it("zeroes the flagged player's clock when a move arrives after time is already up", async () => {
    const white = await makeUser('white8c');
    const black = await makeUser('black8c');

    // FIXME: we shouldn't be hitting pg at all.
    // Mock only Date.now(), not setTimeout/fake timers - vi.useFakeTimers()
    // would also fake the real pg driver's own internal timers and corrupt
    // the connection (a real Postgres round-trip resolves via libuv's I/O
    // poll phase, independent of JS timers - faking those out from under
    // the driver breaks it). Date.now() alone doesn't affect when the real,
    // already-scheduled flag-fall timer actually fires (it's a genuine ~60s away in
    // wall-clock time), so this move reaches enforceClock - and finalizes
    // the game - well before that background timer ever gets a chance to,
    // deterministically exercising enforceClock's branch instead of
    // handleFlagFall's.
    const dateSpy = vi.spyOn(Date, 'now');
    try {
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 60, incrementSeconds: 0 },
        true,
      );
      await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
      const { game: gameAfterBlackMove } = await ctx.gamesService.applyMove(
        game.id,
        black.id,
        'e7',
        'e5',
      );

      dateSpy.mockReturnValue(Date.now() + 61_000);

      await expect(
        ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3'),
      ).rejects.toThrow('Flagged on time');

      dateSpy.mockRestore();

      const finalGame = await ctx.gamesService.getGameOrThrow(game.id);
      expect(finalGame.status).toBe('completed');
      expect(finalGame.result).toBe('black');
      expect(finalGame.resultReason).toBe('timeout');
      expect(finalGame.whiteTimeRemainingMs).toBe(0);
      // Only the loser's clock is forced to 0 - black's (whatever it was
      // left at after their own move) is untouched by the fix.
      expect(finalGame.blackTimeRemainingMs).toBe(
        gameAfterBlackMove.blackTimeRemainingMs,
      );
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("doesn't run either clock until both sides have moved", async () => {
    const white = await makeUser('white8f');
    const black = await makeUser('black8f');
    const fiveMinutes = toClockMs({ initialSeconds: 300, incrementSeconds: 3 });
    const dateSpy = vi.spyOn(Date, 'now');
    try {
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 3 },
        true,
      );
      dateSpy.mockReturnValue(Date.now() + 10_000);
      await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
      dateSpy.mockReturnValue(Date.now() + 10_000);
      const { game: afterBoth } = await ctx.gamesService.applyMove(
        game.id,
        black.id,
        'e7',
        'e5',
      );

      expect(afterBoth.whiteTimeRemainingMs).toBe(fiveMinutes);
      expect(afterBoth.blackTimeRemainingMs).toBe(fiveMinutes);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("adds the increment from each side's second move, not its first", async () => {
    const white = await makeUser('white8i');
    const black = await makeUser('black8i');
    const twoMinutes = toClockMs({ initialSeconds: 120, incrementSeconds: 1 });
    const dateSpy = vi.spyOn(Date, 'now');
    try {
      const startedAt = Date.now();
      dateSpy.mockReturnValue(startedAt);
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 120, incrementSeconds: 1 },
        true,
      );
      const { game: afterFirstMove } = await ctx.gamesService.applyMove(
        game.id,
        white.id,
        'e2',
        'e4',
      );
      expect(afterFirstMove.whiteTimeRemainingMs).toBe(twoMinutes);

      await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
      dateSpy.mockReturnValue(startedAt + 4_000);
      const { game: afterSecondMove } = await ctx.gamesService.applyMove(
        game.id,
        white.id,
        'g1',
        'f3',
      );

      // 4 seconds used, 1 second back.
      expect(afterSecondMove.whiteTimeRemainingMs).toBe(twoMinutes - 3_000);
      expect(afterSecondMove.blackTimeRemainingMs).toBe(twoMinutes);
    } finally {
      dateSpy.mockRestore();
    }
  });

  describe('pre-moves', () => {
    const tc: TimeControl = { initialSeconds: 120, incrementSeconds: 1 };
    const twoMinutes = toClockMs(tc);

    /** A game both sides have made their first move in, so the clocks are
     * running, with Date.now() held at `startedAt` until moved on. */
    async function gameUnderWay(name: string, timeControl = tc) {
      const white = await makeUser(`${name}w`);
      const black = await makeUser(`${name}b`);
      const startedAt = Date.now();
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
      const game = await ctx.gamesService.createGame(
        white,
        black,
        timeControl,
        true,
      );
      await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
      await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
      return { white, black, game, startedAt, dateSpy };
    }

    function movesPlayed(gameId: string): string[] {
      const sans: string[] = [];
      ctx.eventEmitter.on(DOMAIN_EVENTS.GAME_MOVE, ({ game, move }) => {
        if (game.id === gameId) sans.push(move.san);
      });
      return sans;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("plays a queued pre-move the moment the opponent's move lands, charging it 100ms", async () => {
      const { white, black, game, startedAt, dateSpy } =
        await gameUnderWay('pm1');
      const sans = movesPlayed(game.id);

      await ctx.gamesService.setPremove(game.id, black.id, 'b8', 'c6');
      expect(sans).toEqual([]);

      dateSpy.mockReturnValue(startedAt + 4_000);
      await ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3');

      expect(sans).toEqual(['Nf3', 'Nc6']);
      const after = await ctx.gamesService.getGameOrThrow(game.id);
      expect(after.turn).toBe('w');
      // 100ms charged, 1 second back - not the 4 seconds white took.
      expect(after.blackTimeRemainingMs).toBe(twoMinutes - 100 + 1_000);
      expect(after.whiteTimeRemainingMs).toBe(twoMinutes - 4_000 + 1_000);
      expect(after.lastMoveAt?.getTime()).toBe(startedAt + 4_000);
    });

    it('drops a pre-move no longer legal once the opponent has moved', async () => {
      const { white, black, game } = await gameUnderWay('pm2');
      const sans = movesPlayed(game.id);

      // exd4 - only a move if white plays d4.
      await ctx.gamesService.setPremove(game.id, black.id, 'e5', 'd4');
      await ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3');

      expect(sans).toEqual(['Nf3']);
      const after = await ctx.gamesService.getGameOrThrow(game.id);
      expect(after.turn).toBe('b');

      // And it's gone, not waiting for the next move.
      await ctx.gamesService.applyMove(game.id, black.id, 'b8', 'c6');
      await ctx.gamesService.applyMove(game.id, white.id, 'd2', 'd4');
      expect(sans).toEqual(['Nf3', 'Nc6', 'd4']);
    });

    it('replaces a queued pre-move with a new one, and plays only that', async () => {
      const { white, black, game } = await gameUnderWay('pm3');
      const sans = movesPlayed(game.id);

      await ctx.gamesService.setPremove(game.id, black.id, 'b8', 'c6');
      await ctx.gamesService.setPremove(game.id, black.id, 'g8', 'f6');
      await ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3');

      expect(sans).toEqual(['Nf3', 'Nf6']);
    });

    it('plays nothing once a pre-move is cancelled', async () => {
      const { white, black, game } = await gameUnderWay('pm4');
      const sans = movesPlayed(game.id);

      await ctx.gamesService.setPremove(game.id, black.id, 'b8', 'c6');
      await ctx.gamesService.cancelPremove(game.id, black.id);
      await ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3');

      expect(sans).toEqual(['Nf3']);
    });

    it("plays a pre-move sent on the player's own turn as a move", async () => {
      const { white, game } = await gameUnderWay('pm5');
      const sans = movesPlayed(game.id);

      // The opponent's move got there first: it's white's turn already.
      await ctx.gamesService.setPremove(game.id, white.id, 'g1', 'f3');

      expect(sans).toEqual(['Nf3']);
      const after = await ctx.gamesService.getGameOrThrow(game.id);
      expect(after.turn).toBe('b');
    });

    it("doesn't play a pre-move its player hasn't 100ms left for", async () => {
      // No increment, which would put black back over 100ms.
      const { white, black, game, startedAt, dateSpy } = await gameUnderWay(
        'pm6',
        { initialSeconds: 120, incrementSeconds: 0 },
      );
      const sans = movesPlayed(game.id);

      await ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3');
      // Black spends all but 50ms of their clock.
      dateSpy.mockReturnValue(startedAt + twoMinutes - 50);
      await ctx.gamesService.applyMove(game.id, black.id, 'b8', 'c6');
      await ctx.gamesService.setPremove(game.id, black.id, 'g8', 'f6');
      dateSpy.mockReturnValue(startedAt + twoMinutes + 950);
      await ctx.gamesService.applyMove(game.id, white.id, 'f1', 'c4');

      expect(sans).toEqual(['Nf3', 'Nc6', 'Bc4']);
      const after = await ctx.gamesService.getGameOrThrow(game.id);
      expect(after.turn).toBe('b');
      expect(after.status).toBe('active');
    });

    it("plays a pre-move queued before either side's first move, charging nothing", async () => {
      const white = await makeUser('pm7w');
      const black = await makeUser('pm7b');
      const game = await ctx.gamesService.createGame(white, black, tc, true);
      const sans = movesPlayed(game.id);

      await ctx.gamesService.setPremove(game.id, black.id, 'e7', 'e5');
      await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');

      expect(sans).toEqual(['e4', 'e5']);
      const after = await ctx.gamesService.getGameOrThrow(game.id);
      expect(after.blackTimeRemainingMs).toBe(twoMinutes);
    });

    it('refuses a pre-move from someone not playing, or in a game over', async () => {
      const { white, black, game } = await gameUnderWay('pm8');
      const outsider = await makeUser('pm8o');

      await expect(
        ctx.gamesService.setPremove(game.id, outsider.id, 'b8', 'c6'),
      ).rejects.toThrow('You are not a player in this game');

      await ctx.gamesService.resign(game.id, white.id);
      await expect(
        ctx.gamesService.setPremove(game.id, black.id, 'b8', 'c6'),
      ).rejects.toThrow('Game is not active');
    });
  });

  it('aborts a game whose first move comes too late', async () => {
    const white = await makeUser('white8g');
    const black = await makeUser('black8g');
    const dateSpy = vi.spyOn(Date, 'now');
    try {
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      dateSpy.mockReturnValue(Date.now() + 31_000);

      await expect(
        ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4'),
      ).rejects.toThrow('Too late for the first move');

      dateSpy.mockRestore();
      const finalGame = await ctx.gamesService.getGameOrThrow(game.id);
      expect(finalGame.status).toBe('aborted');
      expect(finalGame.resultReason).toBe('abort');
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('aborts a game by itself once the first-move deadline passes', async () => {
    process.env.GAME_FIRST_MOVE_TIMEOUT_MS = '100';
    try {
      const white = await makeUser('white8h');
      const black = await makeUser('black8h');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      const gameEnded = waitForGameEnded(ctx.eventEmitter, game.id);
      await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');

      const { game: finalGame } = await gameEnded;

      expect(finalGame.status).toBe('aborted');
      expect(finalGame.resultReason).toBe('abort');
    } finally {
      delete process.env.GAME_FIRST_MOVE_TIMEOUT_MS;
    }
  });

  describe('daily games', () => {
    const THREE_DAYS: TimeControl = {
      initialSeconds: 3 * 24 * 60 * 60,
      incrementSeconds: 0,
    };
    const THREE_DAYS_MS = toClockMs(THREE_DAYS);

    it("resets the mover's clock to the full days with every move, first moves included", async () => {
      const white = await makeUser('dailyw1');
      const black = await makeUser('dailyb1');
      const dateSpy = vi.spyOn(Date, 'now');
      try {
        const game = await ctx.gamesService.createGame(
          white,
          black,
          THREE_DAYS,
          true,
        );
        expect(game.gameType).toBe('daily');
        expect(game.seriesWhitePoints).toBe(0);

        const start = Date.now();
        dateSpy.mockReturnValue(start + 2 * 86_400_000);
        await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
        dateSpy.mockReturnValue(start + 4 * 86_400_000);
        await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
        dateSpy.mockReturnValue(start + 5 * 86_400_000);
        const { game: after } = await ctx.gamesService.applyMove(
          game.id,
          white.id,
          'g1',
          'f3',
        );

        expect(after.whiteTimeRemainingMs).toBe(THREE_DAYS_MS);
        expect(after.blackTimeRemainingMs).toBe(THREE_DAYS_MS);
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('flags a move made after its days have run out', async () => {
      const white = await makeUser('dailyw2');
      const black = await makeUser('dailyb2');
      const dateSpy = vi.spyOn(Date, 'now');
      try {
        const game = await ctx.gamesService.createGame(
          white,
          black,
          THREE_DAYS,
          true,
        );
        await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
        await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');

        dateSpy.mockReturnValue(Date.now() + THREE_DAYS_MS + 1_000);
        await expect(
          ctx.gamesService.applyMove(game.id, white.id, 'g1', 'f3'),
        ).rejects.toThrow('Flagged on time');

        const finalGame = await ctx.gamesService.getGameOrThrow(game.id);
        expect(finalGame.resultReason).toBe('timeout');
        expect(finalGame.result).toBe('black');
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('aborts a game whose first move comes after its days', async () => {
      const white = await makeUser('dailyw3');
      const black = await makeUser('dailyb3');
      const dateSpy = vi.spyOn(Date, 'now');
      try {
        const game = await ctx.gamesService.createGame(
          white,
          black,
          THREE_DAYS,
          true,
        );
        // Well past a live game's 30 seconds, still inside its days.
        dateSpy.mockReturnValue(Date.now() + 86_400_000);
        await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');

        dateSpy.mockReturnValue(Date.now() + 86_400_000 + THREE_DAYS_MS + 1);
        await expect(
          ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5'),
        ).rejects.toThrow('Too late for the first move');
        expect((await ctx.gamesService.getGameOrThrow(game.id)).status).toBe(
          'aborted',
        );
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('ends daily games out of time from the database, and only those', async () => {
      const white = await makeUser('dailyw4');
      const black = await makeUser('dailyb4');
      const dateSpy = vi.spyOn(Date, 'now');
      try {
        const played = await ctx.gamesService.createGame(
          white,
          black,
          { initialSeconds: 24 * 60 * 60, incrementSeconds: 0 },
          true,
        );
        await ctx.gamesService.applyMove(played.id, white.id, 'e2', 'e4');
        await ctx.gamesService.applyMove(played.id, black.id, 'e7', 'e5');
        const unstarted = await ctx.gamesService.createGame(
          white,
          black,
          { initialSeconds: 24 * 60 * 60, incrementSeconds: 0 },
          true,
        );
        const longer = await ctx.gamesService.createGame(
          white,
          black,
          THREE_DAYS,
          true,
        );

        const twoDaysOn = Date.now() + 2 * 86_400_000;
        dateSpy.mockReturnValue(twoDaysOn);
        expect(
          await ctx.gamesService.expireOverdueDailyGames(new Date(twoDaysOn)),
        ).toBe(2);

        const timedOut = await ctx.gamesService.getGameWithMoves(played.id);
        expect(timedOut.resultReason).toBe('timeout');
        expect(timedOut.result).toBe('black');
        expect(
          (await ctx.gamesService.getGameWithMoves(unstarted.id)).status,
        ).toBe('aborted');
        expect(
          (await ctx.gamesService.getGameWithMoves(longer.id)).status,
        ).toBe('active');
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('refuses a pre-move', async () => {
      const white = await makeUser('dailyw5');
      const black = await makeUser('dailyb5');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        THREE_DAYS,
        true,
      );

      await expect(
        ctx.gamesService.setPremove(game.id, black.id, 'e7', 'e5'),
      ).rejects.toThrow('Daily games have no pre-moves');
    });

    it('is not forfeited by its player going offline', async () => {
      const white = await makeUser('dailyw6');
      const black = await makeUser('dailyb6');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        THREE_DAYS,
        true,
      );
      await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
      await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');

      await ctx.gamesService.forfeitByAbandonment(game.id, white.id);

      expect((await ctx.gamesService.getGameOrThrow(game.id)).status).toBe(
        'active',
      );
    });

    it("is played alongside a live game, and isn't the game a player is watched in", async () => {
      const white = await makeUser('dailyw7');
      const black = await makeUser('dailyb7');
      await ctx.gamesService.createGame(white, black, THREE_DAYS, true);

      await expect(
        ctx.gamesService.assertNotPlaying(white.id),
      ).resolves.toBeUndefined();
      expect((await ctx.gamesService.activeGameIdsFor([white.id])).size).toBe(
        0,
      );
      expect(await ctx.gamesService.countActiveGames()).toBe(0);

      const live = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      await expect(ctx.gamesService.assertNotPlaying(white.id)).rejects.toThrow(
        'Finish your game in progress first',
      );
      await expect(
        ctx.gamesService.assertCanStart(white.id, THREE_DAYS),
      ).resolves.toBeUndefined();
      expect(
        (await ctx.gamesService.activeGameIdsFor([white.id])).get(white.id),
      ).toBe(live.id);
    });

    it(`holds a player to ${MAX_ACTIVE_DAILY_GAMES} daily games at once`, async () => {
      const white = await makeUser('dailyw8');
      const black = await makeUser('dailyb8');
      for (let i = 0; i < MAX_ACTIVE_DAILY_GAMES - 1; i++) {
        await ctx.gamesService.createGame(white, black, THREE_DAYS, false);
      }
      await expect(
        ctx.gamesService.assertCanStart(black.id, THREE_DAYS),
      ).resolves.toBeUndefined();

      await ctx.gamesService.createGame(white, black, THREE_DAYS, false);
      await expect(
        ctx.gamesService.assertCanStart(black.id, THREE_DAYS),
      ).rejects.toThrow('at most 50 daily games');
    });

    it("lists a player's daily games in progress, their move first, then by time left", async () => {
      const amy = await makeUser('dailyw9');
      const ben = await makeUser('dailyb9');
      const ONE_DAY: TimeControl = {
        initialSeconds: 24 * 60 * 60,
        incrementSeconds: 0,
      };
      const threeDaysAmysMove = await ctx.gamesService.createGame(
        amy,
        ben,
        THREE_DAYS,
        true,
      );
      const oneDayAmysMove = await ctx.gamesService.createGame(
        amy,
        ben,
        ONE_DAY,
        true,
      );
      const bensMove = await ctx.gamesService.createGame(
        amy,
        ben,
        ONE_DAY,
        true,
      );
      await ctx.gamesService.applyMove(bensMove.id, amy.id, 'e2', 'e4');
      await ctx.gamesService.createGame(
        amy,
        ben,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );

      const listed = await ctx.gamesService.listDailyGamesForUser(amy.id);

      expect(listed.map(({ game }) => game.id)).toEqual([
        oneDayAmysMove.id,
        threeDaysAmysMove.id,
        bensMove.id,
      ]);
      expect(listed.map(({ myTurn }) => myTurn)).toEqual([true, true, false]);
      expect(listed[2].lastMove).toEqual({ from: 'e2', to: 'e4' });
      expect(listed[0].lastMove).toBeNull();
      expect(listed[2].game.black.username).toBe('dailyb9');
      expect(
        (await ctx.gamesService.listDailyGamesForUser(ben.id)).map(
          ({ game }) => game.id,
        )[0],
      ).toBe(bensMove.id);
      expect(
        await ctx.gamesService.listDailyGamesForUser(amy.id, 1),
      ).toHaveLength(1);
    });

    describe('conditional moves', () => {
      async function startedGame(suffix: string) {
        const alice = await makeUser(`condw${suffix}`);
        const bob = await makeUser(`condb${suffix}`);
        const game = await ctx.gamesService.createGame(
          alice,
          bob,
          THREE_DAYS,
          true,
        );
        await ctx.gamesService.applyMove(game.id, alice.id, 'e2', 'e4');
        return { alice, bob, game };
      }

      it("plays the reply to the opponent's move the moment it lands, keeping what follows", async () => {
        const { alice, bob, game } = await startedGame('1');
        await ctx.conditionalMoves.add(alice.id, game.id, 1, [
          ['e7e5', 'g1f3', 'b8c6', 'f1b5'],
          ['c7c5', 'b1c3'],
        ]);

        await ctx.gamesService.applyMove(game.id, bob.id, 'e7', 'e5');

        const after = await ctx.gamesService.getGameWithMoves(game.id);
        expect(after.moves.map((move) => move.san)).toEqual([
          'e4',
          'e5',
          'Nf3',
        ]);
        expect(after.turn).toBe('b');
        expect(await ctx.conditionalMoves.get(alice.id, game.id)).toEqual({
          basePly: 3,
          lines: [['b8c6', 'f1b5']],
        });
      });

      it("drops them all on a move they didn't foresee", async () => {
        const { alice, bob, game } = await startedGame('2');
        await ctx.conditionalMoves.add(alice.id, game.id, 1, [
          ['e7e5', 'g1f3'],
        ]);

        await ctx.gamesService.applyMove(game.id, bob.id, 'd7', 'd5');

        const after = await ctx.gamesService.getGameWithMoves(game.id);
        expect(after.moves).toHaveLength(2);
        expect(after.turn).toBe('w');
        expect(await ctx.conditionalMoves.get(alice.id, game.id)).toEqual({
          basePly: null,
          lines: [],
        });
      });

      it('adds to the lines saved from the same position', async () => {
        const { alice, game } = await startedGame('3');
        await ctx.conditionalMoves.add(alice.id, game.id, 1, [
          ['e7e5', 'g1f3'],
        ]);

        const saved = await ctx.conditionalMoves.add(alice.id, game.id, 1, [
          ['e7e5', 'g1f3', 'b8c6', 'f1c4'],
          ['c7c5', 'b1c3', 'b8c6'],
        ]);

        expect(saved.lines).toEqual([
          ['e7e5', 'g1f3', 'b8c6', 'f1c4'],
          ['c7c5', 'b1c3'],
        ]);
      });

      it('refuses lines on your own move, from a position gone, or not legal', async () => {
        const { alice, bob, game } = await startedGame('4');

        await expect(
          ctx.conditionalMoves.add(bob.id, game.id, 1, [['g1f3', 'e7e5']]),
        ).rejects.toThrow("It's your move");
        await expect(
          ctx.conditionalMoves.add(alice.id, game.id, 0, [['e7e5', 'g1f3']]),
        ).rejects.toThrow('The game has moved on since');
        await expect(
          ctx.conditionalMoves.add(alice.id, game.id, 1, [['e7e5', 'e1e3']]),
        ).rejects.toThrow('Illegal move in a line: e1e3');
        await expect(
          ctx.conditionalMoves.add(alice.id, game.id, 1, [
            ['e7e5', 'g1f3'],
            ['e7e5', 'f1c4'],
          ]),
        ).rejects.toThrow('Two different replies to e7e5');
      });

      it('has none in a live game', async () => {
        const alice = await makeUser('condw5');
        const bob = await makeUser('condb5');
        const game = await ctx.gamesService.createGame(
          alice,
          bob,
          { initialSeconds: 300, incrementSeconds: 0 },
          true,
        );
        await ctx.gamesService.applyMove(game.id, alice.id, 'e2', 'e4');

        await expect(
          ctx.conditionalMoves.add(alice.id, game.id, 1, [['e7e5', 'g1f3']]),
        ).rejects.toThrow('Only daily games have conditional moves');
      });

      it('drops them when the game ends', async () => {
        const { alice, bob, game } = await startedGame('6');
        await ctx.gamesService.applyMove(game.id, bob.id, 'e7', 'e5');
        await ctx.gamesService.applyMove(game.id, alice.id, 'g1', 'f3');
        await ctx.conditionalMoves.add(alice.id, game.id, 3, [
          ['b8c6', 'f1b5'],
        ]);

        await ctx.gamesService.resign(game.id, bob.id);

        expect(
          await ctx.moduleRef
            .get(DataSource)
            .query(
              'SELECT "deletedAt" IS NOT NULL AS "dropped" FROM conditional_moves',
            ),
        ).toEqual([{ dropped: true }]);
      });
    });
  });

  it('does not let guest games affect ratings', async () => {
    const white = await makeUser('white9');
    const guest = await ctx.usersService.createGuestUser();
    const game = await ctx.gamesService.createGame(
      white,
      guest,
      { initialSeconds: 300, incrementSeconds: 0 },
      true,
    );
    expect(game.rated).toBe(false);
  });

  describe('game ratings', () => {
    const NEW_PLAYER_WIN = Math.round(
      rateGame(newPlayerRating(), newPlayerRating(), 1, 1).rating - 1500,
    );

    it("records each registered player's rating when the game starts", async () => {
      const white = await makeUser('ratedwhite1');
      const black = await makeUser('ratedblack1');
      await ctx.ratingsRepo.update(
        { userId: white.id, category: 'blitz' },
        { rating: 1620 },
      );

      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );

      expect(game.whiteRatingAtStart).toBe(1620);
      expect(game.blackRatingAtStart).toBe(STARTING_RATING);
      expect(game.whiteRatingDiff).toBeNull();
      expect(game.blackRatingDiff).toBeNull();
    });

    it("records no rating for a guest, who doesn't have one", async () => {
      const white = await makeUser('ratedwhite2');
      const guest = await ctx.usersService.createGuestUser();

      const game = await ctx.gamesService.createGame(
        white,
        guest,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );

      expect(game.whiteRatingAtStart).toBe(STARTING_RATING);
      expect(game.blackRatingAtStart).toBeNull();
    });

    it('records what a rated game did to both ratings when it ends', async () => {
      const white = await makeUser('ratedwhite3');
      const black = await makeUser('ratedblack3');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );

      await playFoolsMate(game.id, white.id, black.id);

      const finished = await ctx.gamesService.getGameWithMoves(game.id);
      expect(finished.whiteRatingDiff).toBe(-NEW_PLAYER_WIN);
      expect(finished.blackRatingDiff).toBe(NEW_PLAYER_WIN);
      expect(finished.whiteRatingAtStart).toBe(STARTING_RATING);
      expect(finished.blackRatingAtStart).toBe(STARTING_RATING);
    });

    it("rates from the players' current ratings when the game ends", async () => {
      const white = await makeUser('ratedwhite4');
      const black = await makeUser('ratedblack4');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      const whiteRatingAfterAnotherGameEnded = 1900;
      await ctx.ratingsRepo.update(
        { userId: white.id, category: 'blitz' },
        { rating: whiteRatingAfterAnotherGameEnded },
      );

      await playFoolsMate(game.id, white.id, black.id);

      const expectedWhite = rateGame(
        { ...newPlayerRating(), rating: whiteRatingAfterAnotherGameEnded },
        newPlayerRating(),
        0,
        1,
      );
      expect((await blitzRating(white.id)).rating).toBeCloseTo(
        expectedWhite.rating,
        6,
      );
    });

    it('records ratings but no change for a casual game', async () => {
      const white = await makeUser('ratedwhite5');
      const black = await makeUser('ratedblack5');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        false,
      );

      await playFoolsMate(game.id, white.id, black.id);

      const finished = await ctx.gamesService.getGameWithMoves(game.id);
      expect(finished.whiteRatingAtStart).toBe(STARTING_RATING);
      expect(finished.whiteRatingDiff).toBeNull();
      expect(finished.blackRatingDiff).toBeNull();
    });

    it('records no change for an aborted game', async () => {
      const white = await makeUser('ratedwhite6');
      const black = await makeUser('ratedblack6');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );

      await ctx.gamesService.abort(game.id, black.id);

      const finished = await ctx.gamesService.getGameWithMoves(game.id);
      expect(finished.whiteRatingDiff).toBeNull();
      expect(finished.blackRatingDiff).toBeNull();
    });

    it('sends the rating changes with the game.ended event', async () => {
      const white = await makeUser('ratedwhite7');
      const black = await makeUser('ratedblack7');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { initialSeconds: 300, incrementSeconds: 0 },
        true,
      );
      const ended = waitForGameEnded(ctx.eventEmitter, game.id);

      await playFoolsMate(game.id, white.id, black.id);

      const { game: endedGame } = await ended;
      expect(endedGame.whiteRatingDiff).toBe(-NEW_PLAYER_WIN);
      expect(endedGame.blackRatingDiff).toBe(NEW_PLAYER_WIN);
    });
  });
});

describe('GamesService with GAME_START_FEN', () => {
  // White's pawn on e7 is a move from promoting.
  const START = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';
  let ctx: Awaited<ReturnType<typeof buildModule>>;

  beforeEach(async () => {
    ctx = await buildModule({ startFen: START });
  });

  afterEach(async () => {
    await ctx.moduleRef.close();
  });

  it('starts new games from that position, playable from there', async () => {
    const make = (username: string) =>
      ctx.usersService.createRegisteredUser({
        username,
        email: `${username}@example.com`,
        passwordHash: 'hash',
      });
    const white = await make('fenwhite');
    const black = await make('fenblack');

    const game = await ctx.gamesService.createGame(
      white,
      black,
      { initialSeconds: 300, incrementSeconds: 0 },
      false,
    );
    expect(game.fen).toBe(START);
    expect(game.turn).toBe('w');

    // e7-e8 is legal only from this position, not the usual one.
    const { game: after } = await ctx.gamesService.applyMove(
      game.id,
      white.id,
      'e7',
      'e8',
      'q',
    );
    expect(after.fen.split(' ')[0]).toBe('k3Q3/8/8/8/8/8/8/4K3');
  });
});
