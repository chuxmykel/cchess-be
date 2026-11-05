import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, registerUser } from './utils/app.js';

describe('Daily games (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('posts a seek, lists and withdraws it, and starts a game from one', async () => {
    const ivan = await registerUser(app, 'ivan_daily');
    const judy = await registerUser(app, 'judy_daily');
    const server = app.getHttpServer();

    const queued = await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ days: 3, color: 'white' })
      .expect(201);
    expect(queued.body.status).toBe('queued');
    expect(queued.body.seek).toMatchObject({
      days: 3,
      rated: true,
      ratingRange: null,
      color: 'white',
    });

    const listed = await request(server)
      .get('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(listed.body.map((seek: { id: string }) => seek.id)).toEqual([
      queued.body.seek.id,
    ]);

    const matched = await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ days: 3 })
      .expect(201);
    expect(matched.body.status).toBe('matched');
    expect(matched.body.game).toMatchObject({
      gameType: 'daily',
      daysPerMove: 3,
      firstMoveDeadline: null,
    });
    expect(matched.body.game.white.username).toBe(ivan.username);
    expect(
      new Date(matched.body.game.moveDeadlineAt).getTime(),
    ).toBeGreaterThan(Date.now() + 2.9 * 24 * 60 * 60 * 1000);

    const again = await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ days: 1 })
      .expect(201);
    await request(server)
      .delete(`/daily-seeks/${again.body.seek.id}`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(204);
    const empty = await request(server)
      .get('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(empty.body).toEqual([]);
  });

  it('lists your daily games apart from live ones', async () => {
    const ivan = await registerUser(app, 'ivan_daily3');
    const judy = await registerUser(app, 'judy_daily3');
    const server = app.getHttpServer();
    await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ days: 2, color: 'white' })
      .expect(201);
    const matched = await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ days: 2 })
      .expect(201);
    const gameId = matched.body.game.id;
    await request(server)
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ from: 'e2', to: 'e4' })
      .expect(201);

    const daily = await request(server)
      .get('/games/daily')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(daily.body).toEqual([
      expect.objectContaining({
        id: gameId,
        turn: 'b',
        myTurn: true,
        playedAsWhite: false,
        daysPerMove: 2,
        lastMove: { from: 'e2', to: 'e4' },
        opponent: expect.objectContaining({ username: ivan.username }),
      }),
    ]);

    const live = await request(server)
      .get('/games?status=active&kind=live')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(live.body).toEqual([]);
    const dailyOnly = await request(server)
      .get('/games?status=active&kind=daily')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(dailyOnly.body.map((game: { id: string }) => game.id)).toEqual([
      gameId,
    ]);
  });

  it('refuses days not on offer', async () => {
    const ivan = await registerUser(app, 'ivan_daily2');

    await request(app.getHttpServer())
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ days: 4 })
      .expect(400);
  });
});
