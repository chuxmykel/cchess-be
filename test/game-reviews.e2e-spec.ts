import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

const evalAt = (cp: number, pv: string[], depth = 14) => ({
  score: { kind: 'cp', cp },
  pv,
  second: { kind: 'cp', cp: cp - 30 },
  depth,
});

// 1. e4 e5 - three positions.
const EVALS = [
  evalAt(20, ['e2e4', 'e7e5']),
  evalAt(30, ['e7e5', 'g1f3']),
  evalAt(25, ['g1f3', 'b8c6']),
];

const review = (overrides: Record<string, unknown> = {}) => ({
  engine: 'stockfish-19.0.1-lite-single',
  depth: 14,
  whiteAccuracy: 96.5,
  blackAccuracy: 88.25,
  evals: EVALS,
  ...overrides,
});

describe('Game reviews (e2e)', () => {
  let app: INestApplication;
  let ivan: RegisteredUser;
  let judy: RegisteredUser;

  beforeEach(async () => {
    app = await createTestApp();
    ivan = await registerUser(app, 'ivan_reviews');
    judy = await registerUser(app, 'judy_reviews');
    await makeFriends(app, ivan, judy);
  });

  afterEach(async () => {
    await app.close();
  });

  // A game between them, two moves in - and over, unless left on.
  async function playGame({ finish = true } = {}): Promise<string> {
    const server = app.getHttpServer();
    const challenge = await request(server)
      .post('/challenges')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({
        opponentUsername: judy.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    const accepted = await request(server)
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(201);
    const gameId: string = accepted.body.id;
    await request(server)
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ from: 'e2', to: 'e4' })
      .expect(201);
    await request(server)
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ from: 'e7', to: 'e5' })
      .expect(201);
    if (finish) {
      await request(server)
        .post(`/games/${gameId}/resign`)
        .set('Authorization', `Bearer ${ivan.accessToken}`)
        .expect(200);
    }
    return gameId;
  }

  const put = (gameId: string, body: unknown, user = ivan) =>
    request(app.getHttpServer())
      .put(`/games/${gameId}/review`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(body as object);

  const get = (gameId: string, user = judy) =>
    request(app.getHttpServer())
      .get(`/games/${gameId}/review`)
      .set('Authorization', `Bearer ${user.accessToken}`);

  it('keeps a review for anyone to read, with the accuracies in game lists', async () => {
    const gameId = await playGame();
    await get(gameId).expect(404);

    const saved = await put(gameId, review()).expect(200);
    expect(saved.body).toMatchObject({
      gameId,
      depth: 14,
      whiteAccuracy: 96.5,
      blackAccuracy: 88.25,
      evals: EVALS,
    });

    const fetched = await get(gameId).expect(200);
    expect(fetched.body.evals).toEqual(EVALS);

    const judysGames = await request(app.getHttpServer())
      .get('/games')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(judysGames.body[0]).toMatchObject({
      accuracy: 88.25,
      opponentAccuracy: 96.5,
    });
    const ivansGames = await request(app.getHttpServer())
      .get(`/users/${ivan.username}/games`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(ivansGames.body[0]).toMatchObject({
      accuracy: 96.5,
      opponentAccuracy: 88.25,
    });
  });

  it('keeps the deeper of two reviews', async () => {
    const gameId = await playGame();
    await put(gameId, review({ depth: 14 })).expect(200);

    const shallower = await put(
      gameId,
      review({ depth: 10, whiteAccuracy: 50 }),
      judy,
    ).expect(200);
    expect(shallower.body.whiteAccuracy).toBe(96.5);

    const deeper = await put(
      gameId,
      review({ depth: 18, whiteAccuracy: 90 }),
      judy,
    ).expect(200);
    expect(deeper.body).toMatchObject({ depth: 18, whiteAccuracy: 90 });
  });

  it('refuses a game still being played', async () => {
    const gameId = await playGame({ finish: false });
    await put(gameId, review()).expect(400);
  });

  it("refuses evals that don't match the game's positions", async () => {
    const gameId = await playGame();
    const response = await put(
      gameId,
      review({ evals: EVALS.slice(0, 2) }),
    ).expect(400);
    expect(response.body.message).toMatch(/3 positions/);
  });

  it('refuses evals that are malformed', async () => {
    const gameId = await playGame();
    await put(
      gameId,
      review({ evals: [EVALS[0], EVALS[1], evalAt(0, ['nonsense'])] }),
    ).expect(400);
    await put(
      gameId,
      review({
        evals: [EVALS[0], EVALS[1], { ...EVALS[2], score: { kind: 'mate' } }],
      }),
    ).expect(400);
    await put(gameId, review({ whiteAccuracy: 140 })).expect(400);
  });

  it('accepts a mate, and a position with no second line', async () => {
    const gameId = await playGame();
    const evals = [
      EVALS[0],
      EVALS[1],
      {
        score: { kind: 'mate', moves: 3, winner: 'w' },
        pv: ['d1h5'],
        second: null,
        depth: 14,
      },
    ];
    const saved = await put(gameId, review({ evals })).expect(200);
    expect(saved.body.evals[2]).toEqual(evals[2]);
  });

  it("has nothing for a game that doesn't exist", async () => {
    await put('00000000-0000-4000-8000-000000000000', review()).expect(404);
  });
});
