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
import { Game } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { GameEvent, GamesService } from './games.service.js';
import { rateGame } from './glicko2.js';
import { truncateAllTables } from '../../test/utils/db.js';
import { TimeControl, toClockMs } from '../chess/time-control.js';

async function buildModule() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            game: { disconnectGraceMs: 60_000, abortPlyLimit: 2 },
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
        entities: [User, Rating, RefreshToken, Game, Move],
        // Schema already applied via real migrations (see
        // src/database/migrations) - this test module only registers a
        // subset of entities, so synchronize here would be misleading as
        // well as unnecessary.
        synchronize: false,
      }),
      TypeOrmModule.forFeature([User, Rating, Game, Move]),
    ],
    providers: [GamesService, UsersService],
  }).compile();

  await truncateAllTables(moduleRef.get(DataSource));

  return {
    gamesService: moduleRef.get(GamesService),
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
