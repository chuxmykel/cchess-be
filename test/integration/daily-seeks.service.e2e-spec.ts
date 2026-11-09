import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { truncateAllTables } from '../utils/db.js';
import { RefreshToken } from '../../src/auth/entities/refresh-token.entity.js';
import { ClusterModule } from '../../src/cluster/cluster.module.js';
import { requireEnv } from '../../src/common/require-env.js';
import { ConditionalMoveSet } from '../../src/games/entities/conditional-move-set.entity.js';
import { Game } from '../../src/games/entities/game.entity.js';
import { Move } from '../../src/games/entities/move.entity.js';
import { GamesService } from '../../src/games/games.service.js';
import { Rating } from '../../src/users/entities/rating.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import { UsersService } from '../../src/users/users.service.js';
import { DailySeeksService } from '../../src/daily-seeks/daily-seeks.service.js';
import { DailySeek } from '../../src/daily-seeks/entities/daily-seek.entity.js';

const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;

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
        host: requireEnv('DB_HOST'),
        port: Number(requireEnv('DB_PORT')),
        username: requireEnv('DB_USERNAME'),
        password: requireEnv('DB_PASSWORD'),
        database: requireEnv('DB_NAME'),
        entities: [
          User,
          Rating,
          RefreshToken,
          Game,
          Move,
          DailySeek,
          ConditionalMoveSet,
        ],
        synchronize: false,
      }),
      TypeOrmModule.forFeature([
        User,
        Rating,
        Game,
        Move,
        DailySeek,
        ConditionalMoveSet,
      ]),
    ],
    providers: [DailySeeksService, GamesService, UsersService],
  }).compile();

  await truncateAllTables(moduleRef.get(DataSource));

  return {
    dailySeeks: moduleRef.get(DailySeeksService),
    usersService: moduleRef.get(UsersService),
    moduleRef,
  };
}

describe('DailySeeksService', () => {
  let ctx: Awaited<ReturnType<typeof buildModule>>;

  beforeEach(async () => {
    ctx = await buildModule();
  });

  afterEach(async () => {
    await ctx.moduleRef.close();
  });

  function makeUser(username: string) {
    return ctx.usersService.createRegisteredUser({
      username,
      email: `${username}@example.com`,
      passwordHash: 'hash',
    });
  }

  it('leaves a seek waiting when none agrees with it', async () => {
    const alice = await makeUser('alice');

    const result = await ctx.dailySeeks.seek(alice, { days: 3 });

    expect(result.status).toBe('queued');
    const mine = await ctx.dailySeeks.listMine(alice.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      initialSeconds: THREE_DAYS_SECONDS,
      rated: true,
      color: 'random',
    });
  });

  it('starts a daily game with a seek already waiting, which it takes', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await ctx.dailySeeks.seek(alice, { days: 3, color: 'black' });

    const result = await ctx.dailySeeks.seek(bob, { days: 3 });

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') return;
    expect(result.game.gameType).toBe('daily');
    expect(result.game.initialSeconds).toBe(THREE_DAYS_SECONDS);
    expect(result.game.whiteId).toBe(bob.id);
    expect(result.game.blackId).toBe(alice.id);
    expect(await ctx.dailySeeks.listMine(alice.id)).toEqual([]);
    expect(await ctx.dailySeeks.listMine(bob.id)).toEqual([]);
  });

  it("never pairs a player's seeks with each other", async () => {
    const alice = await makeUser('alice');
    await ctx.dailySeeks.seek(alice, { days: 3 });

    expect((await ctx.dailySeeks.seek(alice, { days: 3 })).status).toBe(
      'queued',
    );
    expect(await ctx.dailySeeks.listMine(alice.id)).toHaveLength(2);
  });

  it('gives a waiting seek to only one of two seekers at once', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const carol = await makeUser('carol');
    await ctx.dailySeeks.seek(alice, { days: 3 });

    const results = await Promise.all([
      ctx.dailySeeks.seek(bob, { days: 3 }),
      ctx.dailySeeks.seek(carol, { days: 3 }),
    ]);

    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual(['matched', 'queued']);
  });

  it('withdraws your own seek, not anyone else’s', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const result = await ctx.dailySeeks.seek(alice, { days: 3 });
    if (result.status !== 'queued') throw new Error('expected a queued seek');

    await expect(ctx.dailySeeks.cancel(bob.id, result.seek.id)).rejects.toThrow(
      'Seek not found',
    );
    await ctx.dailySeeks.cancel(alice.id, result.seek.id);
    expect(await ctx.dailySeeks.listMine(alice.id)).toEqual([]);
  });

  it('keeps a withdrawn seek, soft-deleted, and never pairs it', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const result = await ctx.dailySeeks.seek(alice, { days: 3 });
    if (result.status !== 'queued') throw new Error('expected a queued seek');
    await ctx.dailySeeks.cancel(alice.id, result.seek.id);

    expect((await ctx.dailySeeks.seek(bob, { days: 3 })).status).toBe('queued');
    await expect(
      ctx.dailySeeks.cancel(alice.id, result.seek.id),
    ).rejects.toThrow('Seek not found');
    const kept = await ctx.moduleRef
      .get(DataSource)
      .getRepository(DailySeek)
      .findOne({ where: { id: result.seek.id }, withDeleted: true });
    expect(kept?.deletedAt).toBeInstanceOf(Date);
  });
});
