import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DirectMessage } from '../src/messages/entities/direct-message.entity.js';
import { Friendship } from '../src/friends/entities/friendship.entity.js';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity.js';
import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

describe('Account deletion (e2e)', () => {
  let app: INestApplication;
  let ana: RegisteredUser;
  let bob: RegisteredUser;

  const as = (user: RegisteredUser) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${user.accessToken}`),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${user.accessToken}`),
    delete: (path: string) =>
      request(app.getHttpServer())
        .delete(path)
        .set('Authorization', `Bearer ${user.accessToken}`),
  });

  beforeEach(async () => {
    app = await createTestApp();
    ana = await registerUser(app, 'ana');
    bob = await registerUser(app, 'bob');
    await makeFriends(app, ana, bob);
    await as(ana)
      .post(`/messages/${bob.username}`)
      .send({ text: 'hi bob' })
      .expect(201);
  });

  afterEach(async () => {
    await app.close();
  });

  it('needs the password', async () => {
    await as(ana).delete('/users/me').send({ password: 'wrong' }).expect(401);
    await as(ana).get('/users/me').expect(200);
  });

  it('removes what is personal, ends games and keeps them for the opponent', async () => {
    const challenge = await as(ana)
      .post('/challenges')
      .send({
        opponentUsername: bob.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    const game = await as(bob)
      .post(`/challenges/${challenge.body.id}/accept`)
      .expect(201);

    await as(ana)
      .delete('/users/me')
      .send({ password: 'password123' })
      .expect(204);

    // Her token is refused at once, and her password no longer signs in.
    await as(ana).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: ana.username, password: 'password123' })
      .expect(401);

    const ended = await as(bob).get(`/games/${game.body.id}`).expect(200);
    expect(ended.body.status).toBe('aborted');
    expect(ended.body.white.displayName).toBe('Deleted player');
    expect(ended.body.white.username).toMatch(/^deleted_/);

    expect((await as(bob).get('/friends').expect(200)).body).toEqual([]);
    expect((await as(bob).get('/messages').expect(200)).body).toEqual([]);
    await as(bob).get(`/users/${ana.username}`).expect(404);
  });

  it('soft-deletes what is personal, for a purge to erase later', async () => {
    await as(ana)
      .delete('/users/me')
      .send({ password: 'password123' })
      .expect(204);

    const db = app.get(DataSource);
    const kept = [
      await db.getRepository(DirectMessage).find({
        where: { senderId: ana.userId },
        withDeleted: true,
      }),
      await db.getRepository(Friendship).find({
        where: [{ requesterId: ana.userId }, { addresseeId: ana.userId }],
        withDeleted: true,
      }),
      await db.getRepository(RefreshToken).find({
        where: { userId: ana.userId },
        withDeleted: true,
      }),
    ];
    for (const rows of kept) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
    }
  });

  it('deletes a guest without a password', async () => {
    const guest = await request(app.getHttpServer())
      .post('/auth/guest')
      .expect(200);
    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(401);
  });
});
