import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestApp,
  registerUser,
  type RegisteredUser,
} from './utils/app.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('Opening explorer (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
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
      totalGames: 2,
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

  it('refuses something that is no position', async () => {
    const ivan = await registerUser(app, 'ivan_explorer2');

    await as(ivan).get('/explorer').query({ fen: 'not a fen' }).expect(400);
  });
});
