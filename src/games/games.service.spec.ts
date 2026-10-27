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
import { Rating, STARTING_RATING } from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { Game } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { GameEvent, GamesService } from './games.service.js';
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
      { minutes: 5, incrementSeconds: 0 },
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
      { minutes: 5, incrementSeconds: 0 },
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

  it('ends the game and updates ratings on checkmate', async () => {
    const white = await makeUser('white3');
    const black = await makeUser('black3');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { minutes: 5, incrementSeconds: 0 },
      true,
    );

    // Fool's mate: black delivers checkmate on move 2.
    await ctx.gamesService.applyMove(game.id, white.id, 'f2', 'f3');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
    await ctx.gamesService.applyMove(game.id, white.id, 'g2', 'g4');
    const { game: finalGame } = await ctx.gamesService.applyMove(
      game.id,
      black.id,
      'd8',
      'h4',
    );

    expect(finalGame.status).toBe('completed');
    expect(finalGame.result).toBe('black');
    expect(finalGame.resultReason).toBe('checkmate');

    // Both players start at the same rating with 0 games played, so
    // expectedScore is exactly 0.5 and the provisional K-factor (40) applies
    // - see elo.ts: round(40 * (1 - 0.5)) = 20, symmetric either direction.
    const blackRatings = await ctx.usersService.getRatings(black.id);
    const blackBlitz = blackRatings.find((r) => r.category === 'blitz')!;
    expect(blackBlitz.rating).toBe(STARTING_RATING + 20);
    expect(blackBlitz.gamesPlayed).toBe(1);

    const whiteRatings = await ctx.usersService.getRatings(white.id);
    const whiteBlitz = whiteRatings.find((r) => r.category === 'blitz')!;
    expect(whiteBlitz.rating).toBe(STARTING_RATING - 20);
    expect(whiteBlitz.gamesPlayed).toBe(1);
  });

  it('uses the established K-factor once a player has 100 games played', async () => {
    const white = await makeUser('white3b');
    const black = await makeUser('black3b');
    // createRegisteredUser already creates a 0-games blitz row for both -
    // bump it to 100 rather than inserting a second one (unique per user+category).
    await ctx.ratingsRepo.update(
      { userId: white.id, category: 'blitz' },
      { gamesPlayed: 100 },
    );
    await ctx.ratingsRepo.update(
      { userId: black.id, category: 'blitz' },
      { gamesPlayed: 100 },
    );
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { minutes: 5, incrementSeconds: 0 },
      true,
    );

    // Fool's mate: black delivers checkmate on move 2.
    await ctx.gamesService.applyMove(game.id, white.id, 'f2', 'f3');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
    await ctx.gamesService.applyMove(game.id, white.id, 'g2', 'g4');
    await ctx.gamesService.applyMove(game.id, black.id, 'd8', 'h4');

    // 100 games played is past PROVISIONAL_GAMES_THRESHOLD (30), so the
    // established K-factor (20, not the provisional 40 above) applies - see
    // elo.ts: round(20 * (1 - 0.5)) = 10, symmetric either direction.
    const blackBlitz = (await ctx.usersService.getRatings(black.id)).find(
      (r) => r.category === 'blitz',
    )!;
    expect(blackBlitz.rating).toBe(STARTING_RATING + 10);
    expect(blackBlitz.gamesPlayed).toBe(101);

    const whiteBlitz = (await ctx.usersService.getRatings(white.id)).find(
      (r) => r.category === 'blitz',
    )!;
    expect(whiteBlitz.rating).toBe(STARTING_RATING - 10);
    expect(whiteBlitz.gamesPlayed).toBe(101);
  });

  it('applies an asymmetric Elo swing for an upset between unequal ratings', async () => {
    const white = await makeUser('white3c');
    const black = await makeUser('black3c');
    // Both past PROVISIONAL_GAMES_THRESHOLD (30) - established K-factor (20)
    // for both, so the only asymmetry comes from the rating gap itself.
    await ctx.ratingsRepo.update(
      { userId: white.id, category: 'blitz' },
      { rating: 1445, gamesPlayed: 50 },
    );
    await ctx.ratingsRepo.update(
      { userId: black.id, category: 'blitz' },
      { rating: 1100, gamesPlayed: 50 },
    );
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { minutes: 5, incrementSeconds: 0 },
      true,
    );

    // Fool's mate: black (the underdog, 1100) delivers checkmate on move 2.
    await ctx.gamesService.applyMove(game.id, white.id, 'f2', 'f3');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
    await ctx.gamesService.applyMove(game.id, white.id, 'g2', 'g4');
    await ctx.gamesService.applyMove(game.id, black.id, 'd8', 'h4');

    // expectedScore(1445, 1100) = 1 / (1 + 10^((1100-1445)/400)) ~= 0.8793,
    // so white (expected to win big) loses more than 20 points and black
    // (expected to lose) gains more than 20 - see elo.ts.
    const blackBlitz = (await ctx.usersService.getRatings(black.id)).find(
      (r) => r.category === 'blitz',
    )!;
    expect(blackBlitz.rating).toBe(1100 + 18);
    expect(blackBlitz.gamesPlayed).toBe(51);

    const whiteBlitz = (await ctx.usersService.getRatings(white.id)).find(
      (r) => r.category === 'blitz',
    )!;
    expect(whiteBlitz.rating).toBe(1445 - 18);
    expect(whiteBlitz.gamesPlayed).toBe(51);
  });

  it('resigns in favor of the opponent', async () => {
    const white = await makeUser('white4');
    const black = await makeUser('black4');
    const game = await ctx.gamesService.createGame(
      white,
      black,
      { minutes: 5, incrementSeconds: 0 },
      true,
    );

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
      { minutes: 5, incrementSeconds: 0 },
      true,
    );

    await ctx.gamesService.offerDraw(game.id, white.id);
    await expect(
      ctx.gamesService.respondDraw(game.id, white.id, true),
    ).rejects.toThrow();

    const result = await ctx.gamesService.respondDraw(game.id, black.id, true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('draw');
    expect(result.resultReason).toBe('draw-agreement');
  });

  it('allows abort within the ply limit but not after', async () => {
    const white = await makeUser('white6');
    const black = await makeUser('black6');

    // 1 ply played, below the configured abortPlyLimit of 2 - still abortable.
    const withinLimit = await ctx.gamesService.createGame(
      white,
      black,
      { minutes: 5, incrementSeconds: 0 },
      true,
    );
    await ctx.gamesService.applyMove(withinLimit.id, white.id, 'e2', 'e4');
    const aborted = await ctx.gamesService.abort(withinLimit.id, black.id);
    expect(aborted.status).toBe('aborted');

    // 2 plies played, at the limit - no longer abortable.
    const pastLimit = await ctx.gamesService.createGame(
      white,
      black,
      { minutes: 5, incrementSeconds: 0 },
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
      { minutes: 5, incrementSeconds: 0 },
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
    const gameMinutes = 0.05 / 60;
    // Short so the test is fast, and non-zero so the assertions below can
    // pin an exact stale value that would otherwise leak through unzeroed
    // on an unfixed handleFlagFall.
    const timeControl: TimeControl = {
      minutes: gameMinutes,
      incrementSeconds: 0,
    };
    const game = await ctx.gamesService.createGame(
      white,
      black,
      timeControl,
      true,
    );

    const { game: finalGame } = await waitForGameEnded(
      ctx.eventEmitter,
      game.id,
    );

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
        { minutes: 1, incrementSeconds: 0 },
        true,
      );
      const { game: gameAfterWhiteMove } = await ctx.gamesService.applyMove(
        game.id,
        white.id,
        'e2',
        'e4',
      );

      dateSpy.mockReturnValue(Date.now() + 61_000);

      await expect(
        ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5'),
      ).rejects.toThrow('Flagged on time');

      dateSpy.mockRestore();

      const finalGame = await ctx.gamesService.getGameOrThrow(game.id);
      expect(finalGame.status).toBe('completed');
      expect(finalGame.result).toBe('white');
      expect(finalGame.resultReason).toBe('timeout');
      expect(finalGame.blackTimeRemainingMs).toBe(0);
      // Only the loser's clock is forced to 0 - white's (whatever it was
      // left at after their own move) is untouched by the fix.
      expect(finalGame.whiteTimeRemainingMs).toBe(
        gameAfterWhiteMove.whiteTimeRemainingMs,
      );
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('does not let guest games affect ratings', async () => {
    const white = await makeUser('white9');
    const guest = await ctx.usersService.createGuestUser();
    const game = await ctx.gamesService.createGame(
      white,
      guest,
      { minutes: 5, incrementSeconds: 0 },
      true,
    );
    expect(game.rated).toBe(false);
  });

  describe('game ratings', () => {
    async function playFoolsMate(
      gameId: string,
      whiteId: string,
      blackId: string,
    ) {
      await ctx.gamesService.applyMove(gameId, whiteId, 'f2', 'f3');
      await ctx.gamesService.applyMove(gameId, blackId, 'e7', 'e5');
      await ctx.gamesService.applyMove(gameId, whiteId, 'g2', 'g4');
      await ctx.gamesService.applyMove(gameId, blackId, 'd8', 'h4');
    }

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
        { minutes: 5, incrementSeconds: 0 },
        true,
      );

      expect(game.whiteRating).toBe(1620);
      expect(game.blackRating).toBe(STARTING_RATING);
      expect(game.whiteRatingDiff).toBeNull();
      expect(game.blackRatingDiff).toBeNull();
    });

    it("records no rating for a guest, who doesn't have one", async () => {
      const white = await makeUser('ratedwhite2');
      const guest = await ctx.usersService.createGuestUser();

      const game = await ctx.gamesService.createGame(
        white,
        guest,
        { minutes: 5, incrementSeconds: 0 },
        true,
      );

      expect(game.whiteRating).toBe(STARTING_RATING);
      expect(game.blackRating).toBeNull();
    });

    it('records what a rated game did to both ratings when it ends', async () => {
      const white = await makeUser('ratedwhite3');
      const black = await makeUser('ratedblack3');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { minutes: 5, incrementSeconds: 0 },
        true,
      );

      await playFoolsMate(game.id, white.id, black.id);

      // Same as 'ends the game and updates ratings on checkmate': equal
      // ratings, provisional K-factor, so 20 points either way.
      const finished = await ctx.gamesService.getGameWithMoves(game.id);
      expect(finished.whiteRatingDiff).toBe(-20);
      expect(finished.blackRatingDiff).toBe(20);
      expect(finished.whiteRating).toBe(STARTING_RATING);
      expect(finished.blackRating).toBe(STARTING_RATING);
    });

    it('rates from the ratings the game started with, not later changes', async () => {
      const white = await makeUser('ratedwhite4');
      const black = await makeUser('ratedblack4');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { minutes: 5, incrementSeconds: 0 },
        true,
      );
      // As if another game finished meanwhile and moved white's rating.
      await ctx.ratingsRepo.update(
        { userId: white.id, category: 'blitz' },
        { rating: 1900 },
      );

      await playFoolsMate(game.id, white.id, black.id);

      const finished = await ctx.gamesService.getGameWithMoves(game.id);
      expect(finished.blackRatingDiff).toBe(20);
      const whiteBlitz = (await ctx.usersService.getRatings(white.id)).find(
        (r) => r.category === 'blitz',
      )!;
      expect(whiteBlitz.rating).toBe(1900 - 20);
    });

    it('records ratings but no change for a casual game', async () => {
      const white = await makeUser('ratedwhite5');
      const black = await makeUser('ratedblack5');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { minutes: 5, incrementSeconds: 0 },
        false,
      );

      await playFoolsMate(game.id, white.id, black.id);

      const finished = await ctx.gamesService.getGameWithMoves(game.id);
      expect(finished.whiteRating).toBe(STARTING_RATING);
      expect(finished.whiteRatingDiff).toBeNull();
      expect(finished.blackRatingDiff).toBeNull();
    });

    it('records no change for an aborted game', async () => {
      const white = await makeUser('ratedwhite6');
      const black = await makeUser('ratedblack6');
      const game = await ctx.gamesService.createGame(
        white,
        black,
        { minutes: 5, incrementSeconds: 0 },
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
        { minutes: 5, incrementSeconds: 0 },
        true,
      );
      const ended = waitForGameEnded(ctx.eventEmitter, game.id);

      await playFoolsMate(game.id, white.id, black.id);

      const { game: endedGame } = await ended;
      expect(endedGame.whiteRatingDiff).toBe(-20);
      expect(endedGame.blackRatingDiff).toBe(20);
    });
  });
});
