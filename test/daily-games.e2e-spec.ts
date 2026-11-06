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

  it("keeps each player's notes on a game to themselves", async () => {
    const ivan = await registerUser(app, 'ivan_notes');
    const judy = await registerUser(app, 'judy_notes');
    const server = app.getHttpServer();
    await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ days: 3 })
      .expect(201);
    const matched = await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ days: 3 })
      .expect(201);
    const notes = `/games/${matched.body.game.id}/notes`;

    const none = await request(server)
      .get(notes)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(none.body).toEqual({ body: '', updatedAt: null });

    await request(server)
      .put(notes)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ body: 'Castle long, then push the h-pawn' })
      .expect(200);
    const saved = await request(server)
      .put(notes)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ body: 'Castle short after all' })
      .expect(200);
    expect(saved.body.body).toBe('Castle short after all');
    expect(saved.body.updatedAt).not.toBeNull();

    const judys = await request(server)
      .get(notes)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(judys.body.body).toBe('');

    await request(server)
      .put(notes)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ body: '   ' })
      .expect(200);
    const cleared = await request(server)
      .get(notes)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(cleared.body).toEqual({ body: '', updatedAt: null });

    await request(server)
      .put(notes)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ body: 'x'.repeat(4001) })
      .expect(400);
  });

  it('saves, plays and drops conditional moves', async () => {
    const ivan = await registerUser(app, 'ivan_cond');
    const judy = await registerUser(app, 'judy_cond');
    const server = app.getHttpServer();
    await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ days: 3, color: 'white' })
      .expect(201);
    const matched = await request(server)
      .post('/daily-seeks')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ days: 3 })
      .expect(201);
    const game = `/games/${matched.body.game.id}`;
    await request(server)
      .post(`${game}/moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ from: 'e2', to: 'e4' })
      .expect(201);

    const saved = await request(server)
      .post(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ basePly: 1, lines: [['e7e5', 'g1f3', 'b8c6', 'f1b5']] })
      .expect(201);
    expect(saved.body).toEqual({
      basePly: 1,
      lines: [['e7e5', 'g1f3', 'b8c6', 'f1b5']],
    });
    const judys = await request(server)
      .get(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(judys.body).toEqual({ basePly: null, lines: [] });

    const reply = await request(server)
      .post(`${game}/moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ from: 'e7', to: 'e5' })
      .expect(201);
    expect(reply.body.moves.map((move: { san: string }) => move.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
    ]);

    const base = { basePly: 3 };
    const replaced = await request(server)
      .put(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({
        ...base,
        lines: [
          ['b8c6', 'f1b5'],
          ['g8f6', 'f3e5'],
        ],
      })
      .expect(200);
    expect(replaced.body.lines).toEqual([
      ['b8c6', 'f1b5'],
      ['g8f6', 'f3e5'],
    ]);
    const again = await request(server)
      .put(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ ...base, lines: [['d7d6', 'd2d4']] })
      .expect(200);
    expect(again.body.lines).toEqual([['d7d6', 'd2d4']]);
    const tooMany = [
      'a7a6',
      'a7a5',
      'b7b6',
      'b7b5',
      'c7c6',
      'c7c5',
      'd7d6',
      'd7d5',
      'f7f6',
      'f7f5',
      'g7g6',
    ].map((move) => [move, 'd2d4']);
    await request(server)
      .put(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ ...base, lines: tooMany })
      .expect(400);

    await request(server)
      .delete(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(204);
    const none = await request(server)
      .get(`${game}/conditional-moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(none.body).toEqual({ basePly: null, lines: [] });
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
