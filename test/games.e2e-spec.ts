import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STARTING_RATING } from '../src/users/entities/rating.entity.js';
import { createTestApp, registerUser } from './utils/app.js';

const EQUAL_RATINGS_PROVISIONAL_SWING = 20;

describe('Games via challenges (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('challenges a user, accepts, plays moves, and resigns', async () => {
    const ivan = await registerUser(app, 'ivan_games');
    const judy = await registerUser(app, 'judy_games');

    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({
        opponentUsername: judy.username,
        minutes: 5,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    expect(challenge.body.status).toBe('pending');

    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;
    expect(accepted.body.white.username).toBe(ivan.username);
    expect(accepted.body.black.username).toBe(judy.username);
    expect(accepted.body.white.rating).toBe(STARTING_RATING);
    expect(accepted.body.black.rating).toBe(STARTING_RATING);

    await request(app.getHttpServer())
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ from: 'e2', to: 'e4' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ from: 'e7', to: 'e5' })
      .expect(201);

    // Judy can't move again - it's Ivan's turn.
    await request(app.getHttpServer())
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ from: 'd7', to: 'd5' })
      .expect(409);

    const resigned = await request(app.getHttpServer())
      .post(`/games/${gameId}/resign`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(resigned.body.result).toBe('black');
    expect(resigned.body.resultReason).toBe('resignation');

    const history = await request(app.getHttpServer())
      .get('/games')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].result).toBe('win');
    expect(history.body[0].opponentRating).toBe(STARTING_RATING);
    expect(history.body[0].ratingDiff).toBe(EQUAL_RATINGS_PROVISIONAL_SWING);

    const loserHistory = await request(app.getHttpServer())
      .get('/games')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(loserHistory.body[0].result).toBe('loss');
    expect(loserHistory.body[0].ratingDiff).toBe(
      -EQUAL_RATINGS_PROVISIONAL_SWING,
    );

    const pgn = await request(app.getHttpServer())
      .get(`/games/${gameId}/pgn`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(pgn.text).toContain(
      '[White "ivan_games"]'.replace('ivan_games', ivan.username),
    );
    expect(pgn.text).toContain('0-1');
  });

  it('matches two seeking players and lets them abort early', async () => {
    const kim = await registerUser(app, 'kim_games');
    const liam = await registerUser(app, 'liam_games');

    await request(app.getHttpServer())
      .post('/matchmaking/seek')
      .set('Authorization', `Bearer ${kim.accessToken}`)
      .send({ minutes: 3, incrementSeconds: 0 })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('queued'));

    const matched = await request(app.getHttpServer())
      .post('/matchmaking/seek')
      .set('Authorization', `Bearer ${liam.accessToken}`)
      .send({ minutes: 3, incrementSeconds: 0 })
      .expect(201);
    expect(matched.body.status).toBe('matched');
    const gameId = matched.body.game.id;
    expect(matched.body.game.gameType).toBe('blitz');

    const otherPlayerToken =
      matched.body.game.white.username === kim.username
        ? kim.accessToken
        : liam.accessToken;

    const aborted = await request(app.getHttpServer())
      .post(`/games/${gameId}/abort`)
      .set('Authorization', `Bearer ${otherPlayerToken}`)
      .expect(200);
    expect(aborted.body.status).toBe('aborted');
  });
});
