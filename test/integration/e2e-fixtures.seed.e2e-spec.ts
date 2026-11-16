import * as bcrypt from 'bcrypt';
import { Chess } from 'chess.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { RefreshToken } from '../../src/auth/entities/refresh-token.entity.js';
import { requireEnv } from '../../src/common/require-env.js';
import {
  E2E_FRIEND,
  E2E_MAIN,
  E2eFixtures1794782381887 as E2eFixtures,
} from '../../src/database/seeds/1794782381887-e2e-fixtures.js';
import {
  BOT_PASSWORD,
  BOT_USERNAMES,
  Bots1793893286008 as Bots,
} from '../../src/database/seeds/1793893286008-bots.js';
import { Friendship } from '../../src/friends/entities/friendship.entity.js';
import { Game } from '../../src/games/entities/game.entity.js';
import { Move } from '../../src/games/entities/move.entity.js';
import { Rating } from '../../src/users/entities/rating.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import { truncateAllTables } from '../utils/db.js';

describe('E2eFixtures seeder', () => {
  let dataSource: DataSource;
  const env = { ...process.env };

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      host: requireEnv('DB_HOST'),
      port: Number(requireEnv('DB_PORT')),
      username: requireEnv('DB_USERNAME'),
      password: requireEnv('DB_PASSWORD'),
      database: requireEnv('DB_NAME'),
      entities: [User, Rating, RefreshToken, Friendship, Game, Move],
      synchronize: false,
    }).initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    process.env.SEED_E2E = '1';
    process.env.NODE_ENV = 'test';
    // As seed:run does: the bots' seeder runs first, its timestamp earlier.
    await new Bots().run(dataSource);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const usernames = async () =>
    (await dataSource.getRepository(User).find()).map((u) => u.username).sort();

  it('does nothing without SEED_E2E=1, so a dev seed:run leaves the database be', async () => {
    delete process.env.SEED_E2E;

    expect(await new E2eFixtures().run(dataSource)).toEqual([]);
    expect(await usernames()).toEqual([...BOT_USERNAMES].sort());
  });

  it('refuses to seed a production database', async () => {
    process.env.NODE_ENV = 'production';

    await expect(new E2eFixtures().run(dataSource)).rejects.toThrow(
      /production/,
    );
  });

  it('creates the two accounts, already friends, signing in with the bots password', async () => {
    await new E2eFixtures().run(dataSource);

    expect(await usernames()).toEqual(
      [...BOT_USERNAMES, E2E_FRIEND, E2E_MAIN].sort(),
    );
    const main = await dataSource
      .getRepository(User)
      .findOneByOrFail({ username: E2E_MAIN });
    expect(await bcrypt.compare(BOT_PASSWORD, main.passwordHash!)).toBe(true);
    const friendships = await dataSource.getRepository(Friendship).find();
    expect(friendships).toEqual([
      expect.objectContaining({ requesterId: main.id, status: 'accepted' }),
    ]);
  });

  it("stores games the app can replay: every move legal, the game's end its last", async () => {
    await new E2eFixtures().run(dataSource);

    const games = await dataSource
      .getRepository(Game)
      .find({ relations: { moves: true } });
    expect(games.length).toBeGreaterThanOrEqual(8);
    for (const game of games) {
      const chess = new Chess();
      const moves = [...game.moves].sort((a, b) => a.ply - b.ply);
      for (const move of moves) {
        expect(chess.move(move.san).san).toBe(move.san);
        expect(move.fenAfter).toBe(chess.fen());
      }
      expect(game.fen).toBe(chess.fen());
      expect(game.turn).toBe(chess.turn());
    }
    const byStatus = (status: string) =>
      games.filter((g) => g.status === status);
    expect(byStatus('completed').length).toBeGreaterThanOrEqual(5);
    expect(byStatus('aborted')).toHaveLength(1);
    expect(byStatus('active').every((g) => g.gameType === 'daily')).toBe(true);
    expect(byStatus('active')).toHaveLength(2);
  });

  it('runs again without adding anything', async () => {
    await new E2eFixtures().run(dataSource);
    const count = await dataSource.getRepository(Game).count();

    expect(await new E2eFixtures().run(dataSource)).toEqual([]);
    expect(await dataSource.getRepository(Game).count()).toBe(count);
  });
});
