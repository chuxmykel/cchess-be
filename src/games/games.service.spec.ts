import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RefreshToken } from '../auth/entities/refresh-token.entity.js';
import { ClusterModule } from '../cluster/cluster.module.js';
import { Rating } from '../users/entities/rating.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { Game } from './entities/game.entity.js';
import { Move } from './entities/move.entity.js';
import { GamesService } from './games.service.js';
import { truncateAllTables } from '../../test/utils/db.js';

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
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME ?? 'cchess',
        password: process.env.DB_PASSWORD ?? 'cchess_dev_password',
        database: process.env.DB_NAME ?? 'cchess_be_test',
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
    moduleRef,
  };
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
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    expect(game.gameType).toBe('blitz');
    expect(game.whiteTimeRemainingMs).toBe(5 * 60 * 1000);
    expect(game.blackTimeRemainingMs).toBe(5 * 60 * 1000);
    expect(game.status).toBe('active');
    expect(game.turn).toBe('w');
  });

  it('applies a legal move and switches turn, rejects illegal moves and wrong-turn moves', async () => {
    const white = await makeUser('white2');
    const black = await makeUser('black2');
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    const { move } = await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
    expect(move.san).toBe('e4');

    await expect(ctx.gamesService.applyMove(game.id, white.id, 'd2', 'd4')).rejects.toThrow("not your turn");
    await expect(ctx.gamesService.applyMove(game.id, black.id, 'a7', 'a4')).rejects.toThrow('Illegal move');
  });

  it('ends the game and updates ratings on checkmate', async () => {
    const white = await makeUser('white3');
    const black = await makeUser('black3');
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    // Fool's mate: black delivers checkmate on move 2.
    await ctx.gamesService.applyMove(game.id, white.id, 'f2', 'f3');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');
    await ctx.gamesService.applyMove(game.id, white.id, 'g2', 'g4');
    const { game: finalGame } = await ctx.gamesService.applyMove(game.id, black.id, 'd8', 'h4');

    expect(finalGame.status).toBe('completed');
    expect(finalGame.result).toBe('black');
    expect(finalGame.resultReason).toBe('checkmate');

    const blackRatings = await ctx.usersService.getRatings(black.id);
    const blackBlitz = blackRatings.find((r) => r.category === 'blitz')!;
    expect(blackBlitz.rating).toBeGreaterThan(1200);
    expect(blackBlitz.gamesPlayed).toBe(1);
  });

  it('resigns in favor of the opponent', async () => {
    const white = await makeUser('white4');
    const black = await makeUser('black4');
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    const resigned = await ctx.gamesService.resign(game.id, white.id);
    expect(resigned.status).toBe('completed');
    expect(resigned.result).toBe('black');
    expect(resigned.resultReason).toBe('resignation');
  });

  it('handles a draw offer and acceptance', async () => {
    const white = await makeUser('white5');
    const black = await makeUser('black5');
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    await ctx.gamesService.offerDraw(game.id, white.id);
    await expect(ctx.gamesService.respondDraw(game.id, white.id, true)).rejects.toThrow();

    const result = await ctx.gamesService.respondDraw(game.id, black.id, true);
    expect(result.status).toBe('completed');
    expect(result.result).toBe('draw');
    expect(result.resultReason).toBe('draw-agreement');
  });

  it('allows abort within the ply limit but not after', async () => {
    const white = await makeUser('white6');
    const black = await makeUser('black6');
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    await ctx.gamesService.applyMove(game.id, white.id, 'e2', 'e4');
    await ctx.gamesService.applyMove(game.id, black.id, 'e7', 'e5');

    await expect(ctx.gamesService.abort(game.id, white.id)).rejects.toThrow('Too late to abort');
  });

  it('aborts a fresh game with no rating impact', async () => {
    const white = await makeUser('white7');
    const black = await makeUser('black7');
    const game = await ctx.gamesService.createGame(white, black, { minutes: 5, incrementSeconds: 0 }, true);

    const aborted = await ctx.gamesService.abort(game.id, black.id);
    expect(aborted.status).toBe('aborted');

    const whiteRatings = await ctx.usersService.getRatings(white.id);
    expect(whiteRatings.find((r) => r.category === 'blitz')!.gamesPlayed).toBe(0);
  });

  it('flags a player on time if their clock runs out', async () => {
    const white = await makeUser('white8');
    const black = await makeUser('black8');
    // 0 minutes + a non-zero increment is a valid time control (see
    // isValidTimeControl) and gives a 0ms starting clock, so the flag-fall
    // timer fires on the next real tick instead of needing fake timers -
    // which don't mix well with genuine async I/O (a real Postgres
    // round-trip resolves via libuv's I/O poll phase, not just the
    // microtask-queue flushing vi.advanceTimersByTimeAsync does).
    const game = await ctx.gamesService.createGame(white, black, { minutes: 0, incrementSeconds: 1 }, true);

    const deadline = Date.now() + 2000;
    let final = await ctx.gamesService.getGameOrThrow(game.id);
    while (final.status === 'active' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      final = await ctx.gamesService.getGameOrThrow(game.id);
    }

    expect(final.status).toBe('completed');
    expect(final.result).toBe('black');
    expect(final.resultReason).toBe('timeout');
  });

  it('does not let guest games affect ratings', async () => {
    const white = await makeUser('white9');
    const guest = await ctx.usersService.createGuestUser();
    const game = await ctx.gamesService.createGame(white, guest, { minutes: 5, incrementSeconds: 0 }, true);
    expect(game.rated).toBe(false);
  });
});
