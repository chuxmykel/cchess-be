import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

describe('Blocking (e2e)', () => {
  let app: INestApplication;
  let ana: RegisteredUser;
  let bob: RegisteredUser;

  const as = (user: RegisteredUser) => {
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${user.accessToken}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string) => auth(server().post(path)),
      delete: (path: string) => auth(server().delete(path)),
    };
  };
  const challenge = (from: RegisteredUser, to: RegisteredUser) =>
    as(from).post('/challenges').send({
      opponentUsername: to.username,
      initialSeconds: 300,
      incrementSeconds: 0,
    });

  beforeEach(async () => {
    app = await createTestApp();
    ana = await registerUser(app, 'ana');
    bob = await registerUser(app, 'bob');
    await makeFriends(app, ana, bob);
  });

  afterEach(async () => {
    await app.close();
  });

  it('ends the friendship and stops friending and challenges, both ways', async () => {
    await challenge(bob, ana).expect(201);
    await as(ana).post(`/users/${bob.username}/block`).expect(204);

    expect((await as(bob).get('/friends').expect(200)).body).toEqual([]);
    expect(
      (await as(ana).get('/challenges').expect(200)).body.incoming ?? [],
    ).toEqual([]);
    await as(bob)
      .post('/friends/requests')
      .send({ username: ana.username })
      .expect(403);
    await as(ana)
      .post('/friends/requests')
      .send({ username: bob.username })
      .expect(403);
    await challenge(bob, ana).expect(403);
    await challenge(ana, bob).expect(403);

    const blocks = (await as(ana).get('/users/me/blocks').expect(200)).body;
    expect(blocks.map((b: { username: string }) => b.username)).toEqual([
      bob.username,
    ]);
    expect(
      (await as(ana).get(`/users/${bob.username}`).expect(200)).body
        .blockedByYou,
    ).toBe(true);
    expect(
      (await as(bob).get(`/users/${ana.username}`).expect(200)).body
        .blockedByYou,
    ).toBe(false);
  });

  it('lets them be friends again once unblocked', async () => {
    await as(ana).post(`/users/${bob.username}/block`).expect(204);
    await as(ana).delete(`/users/${bob.username}/block`).expect(204);
    expect((await as(ana).get('/users/me/blocks').expect(200)).body).toEqual(
      [],
    );
    await as(bob)
      .post('/friends/requests')
      .send({ username: ana.username })
      .expect(201);
  });
});
