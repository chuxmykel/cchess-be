import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LichessExplorerRequest,
  LichessFetchResult,
} from '../src/explorer/lichess/lichess-explorer.client.js';
import { LichessExplorerClient } from '../src/explorer/lichess/lichess-explorer.client.js';
import {
  createTestApp,
  registerUser,
  type RegisteredUser,
} from './utils/app.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const LICHESS_ANSWER: LichessFetchResult = {
  status: 'ok',
  payload: {
    white: 50,
    draws: 30,
    black: 20,
    moves: [
      { uci: 'd2d4', san: 'd4', white: 10, draws: 10, black: 10 },
      { uci: 'e2e4', san: 'e4', white: 40, draws: 20, black: 10 },
    ],
  },
};

/** Lichess, as the tests have it answer. */
function fakeLichess() {
  const fetch = vi.fn(
    async (_request: LichessExplorerRequest): Promise<LichessFetchResult> =>
      LICHESS_ANSWER,
  );
  return { configured: true, fetch };
}

describe('Opening explorer (e2e)', () => {
  let app: INestApplication;
  let lichess: ReturnType<typeof fakeLichess>;

  beforeEach(async () => {
    lichess = fakeLichess();
    app = await createTestApp((builder) =>
      builder.overrideProvider(LichessExplorerClient).useValue(lichess),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (user: RegisteredUser) => ({
    post: (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${user.accessToken}`),
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${user.accessToken}`),
  });

  /** Plays `moves` in a new daily game, white then black, and has
   * `resigner` resign it if given. */
  async function play(
    white: RegisteredUser,
    black: RegisteredUser,
    moves: Array<[string, string]>,
    resigner?: RegisteredUser,
  ) {
    await as(white)
      .post('/daily-seeks')
      .send({ days: 1, color: 'white' })
      .expect(201);
    const matched = await as(black)
      .post('/daily-seeks')
      .send({ days: 1 })
      .expect(201);
    const gameId = matched.body.game.id;
    for (const [index, [from, to]] of moves.entries()) {
      await as(index % 2 === 0 ? white : black)
        .post(`/games/${gameId}/moves`)
        .send({ from, to })
        .expect(201);
    }
    if (resigner)
      await as(resigner).post(`/games/${gameId}/resign`).expect(200);
  }

  it('lists the moves played from a position in finished games, and how they ended', async () => {
    const ivan = await registerUser(app, 'ivan_explorer');
    const judy = await registerUser(app, 'judy_explorer');
    await play(
      ivan,
      judy,
      [
        ['e2', 'e4'],
        ['e7', 'e5'],
      ],
      ivan,
    );
    await play(
      ivan,
      judy,
      [
        ['e2', 'e4'],
        ['c7', 'c5'],
      ],
      judy,
    );
    // Still being played - not to be looked up.
    await play(ivan, judy, [
      ['d2', 'd4'],
      ['d7', 'd5'],
    ]);

    const start = await as(ivan)
      .get('/explorer')
      .query({ fen: START })
      .expect(200);
    expect(start.body).toEqual({
      source: 'cchess',
      stale: false,
      totalGames: 2,
      whiteWins: 1,
      draws: 0,
      blackWins: 1,
      moves: [
        {
          san: 'e4',
          uci: 'e2e4',
          games: 2,
          whiteWins: 1,
          draws: 0,
          blackWins: 1,
        },
      ],
    });

    const afterE4 = await as(ivan)
      .get('/explorer')
      .query({ fen: AFTER_E4 })
      .expect(200);
    expect(afterE4.body.moves.map((m: { san: string }) => m.san)).toEqual([
      'c5',
      'e5',
    ]);
    expect(afterE4.body.moves[0]).toMatchObject({ whiteWins: 1, blackWins: 0 });
  });

  it("lists one player's games, from the side they played", async () => {
    const ivan = await registerUser(app, 'ivan_player');
    const judy = await registerUser(app, 'judy_player');
    await play(
      ivan,
      judy,
      [
        ['e2', 'e4'],
        ['e7', 'e5'],
      ],
      ivan,
    );
    await play(
      judy,
      ivan,
      [
        ['d2', 'd4'],
        ['d7', 'd5'],
      ],
      ivan,
    );

    const explore = (user: RegisteredUser, color: string) =>
      as(ivan)
        .get('/explorer')
        .query({ fen: START, db: 'player', user: user.userId, color })
        .expect(200);

    const asWhite = await explore(ivan, 'white');
    expect(asWhite.body).toMatchObject({
      source: 'player',
      totalGames: 1,
      whiteWins: 0,
      blackWins: 1,
    });
    expect(asWhite.body.moves.map((m: { san: string }) => m.san)).toEqual([
      'e4',
    ]);
    const judyAsWhite = await explore(judy, 'white');
    expect(judyAsWhite.body.moves.map((m: { san: string }) => m.san)).toEqual([
      'd4',
    ]);
    expect((await explore(ivan, 'black')).body.totalGames).toBe(1);
  });

  it("asks lichess once for a position, then answers from what's kept", async () => {
    const ivan = await registerUser(app, 'ivan_lichess');

    for (const db of ['masters', 'masters', 'lichess']) {
      const answer = await as(ivan)
        .get('/explorer')
        .query({ fen: START, db })
        .expect(200);
      expect(answer.body).toEqual({
        source: db,
        stale: false,
        totalGames: 100,
        whiteWins: 50,
        draws: 30,
        blackWins: 20,
        moves: [
          {
            san: 'e4',
            uci: 'e2e4',
            games: 70,
            whiteWins: 40,
            draws: 20,
            blackWins: 10,
          },
          {
            san: 'd4',
            uci: 'd2d4',
            games: 30,
            whiteWins: 10,
            draws: 10,
            blackWins: 10,
          },
        ],
      });
    }

    expect(lichess.fetch.mock.calls.map(([request]) => request)).toEqual([
      { db: 'masters', fen: START, filters: undefined },
      {
        db: 'lichess',
        fen: START,
        filters: {
          speeds: ['blitz', 'classical', 'rapid'],
          ratings: [1600, 1800, 2000, 2200, 2500],
        },
      },
    ]);
    const [masters] = await app
      .get(DataSource)
      .query(
        `SELECT hits FROM explorer_positions WHERE db = 'masters' AND epd = $1`,
        [START.split(' ').slice(0, 4).join(' ')],
      );
    expect(masters.hits).toBe(2);
  });

  it('asks lichess every time for filters other than its defaults, keeping nothing', async () => {
    const ivan = await registerUser(app, 'ivan_filters');

    for (let i = 0; i < 2; i++) {
      await as(ivan)
        .get('/explorer')
        .query({
          fen: START,
          db: 'lichess',
          speeds: 'bullet,blitz',
          ratings: '2500',
        })
        .expect(200);
    }

    expect(lichess.fetch).toHaveBeenCalledTimes(2);
    expect(lichess.fetch.mock.calls[0][0].filters).toEqual({
      speeds: ['blitz', 'bullet'],
      ratings: [2500],
    });
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT COUNT(*)::int AS count FROM explorer_cache`);
    expect(count).toBe(0);
  });

  it('serves an answer over 30 days old, marked stale, and fetches it afresh', async () => {
    const ivan = await registerUser(app, 'ivan_stale');
    await as(ivan)
      .get('/explorer')
      .query({ fen: START, db: 'masters' })
      .expect(200);
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `UPDATE explorer_cache SET "fetchedAt" = now() - interval '31 days'`,
    );

    const stale = await as(ivan)
      .get('/explorer')
      .query({ fen: START, db: 'masters' })
      .expect(200);

    expect(stale.body).toMatchObject({ source: 'masters', stale: true });
    await vi.waitFor(
      async () => {
        const [{ fresh }] = await dataSource.query(
          `SELECT "fetchedAt" > now() - interval '1 minute' AS fresh FROM explorer_cache`,
        );
        expect(fresh).toBe(true);
      },
      { timeout: 5_000 },
    ); // the cache's requests wait a second between them
    expect(lichess.fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches an expired answer again, bringing its row back', async () => {
    const ivan = await registerUser(app, 'ivan_expired');
    await as(ivan)
      .get('/explorer')
      .query({ fen: START, db: 'masters' })
      .expect(200);
    const dataSource = app.get(DataSource);
    await dataSource.query(`UPDATE explorer_cache SET "deletedAt" = now()`);

    await as(ivan)
      .get('/explorer')
      .query({ fen: START, db: 'masters' })
      .expect(200);

    expect(lichess.fetch).toHaveBeenCalledTimes(2);
    expect(
      await dataSource.query(`SELECT "deletedAt" FROM explorer_cache`),
    ).toEqual([{ deletedAt: null }]);
  });

  it('answers from the games played here while lichess is out of reach', async () => {
    const ivan = await registerUser(app, 'ivan_limited');
    lichess.fetch.mockResolvedValueOnce({ status: 'rateLimited' });

    const answer = await as(ivan)
      .get('/explorer')
      .query({ fen: START, db: 'lichess' })
      .expect(200);

    expect(answer.body).toMatchObject({ source: 'cchess', totalGames: 0 });
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT COUNT(*)::int AS count FROM explorer_cache`);
    expect(count).toBe(0);
  });

  it('refuses something that is no position, or a query it can’t answer', async () => {
    const ivan = await registerUser(app, 'ivan_explorer2');
    const explore = (query: Record<string, string>) =>
      as(ivan).get('/explorer').query(query).expect(400);

    await explore({ fen: 'not a fen' });
    await explore({ fen: START, db: 'chessbase' });
    await explore({ fen: START, db: 'lichess', speeds: 'warp' });
    await explore({ fen: START, db: 'lichess', ratings: '1500' });
    await explore({ fen: START, db: 'player' });
    await explore({
      fen: START,
      db: 'player',
      user: ivan.userId,
      color: 'red',
    });
  });
});

describe('Opening explorer without a lichess token (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers from the games played here', async () => {
    const ivan = await registerUser(app, 'ivan_no_token');

    const answer = await request(app.getHttpServer())
      .get('/explorer')
      .query({ fen: START, db: 'masters' })
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);

    expect(answer.body.source).toBe('cchess');
  });
});
