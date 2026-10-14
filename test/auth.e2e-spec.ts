import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from './utils/app.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers, logs in, refreshes, and logs out', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'carol',
        email: 'carol@example.com',
        password: 'password123',
      })
      .expect(201);

    expect(register.body.user.username).toBe('carol');
    expect(register.body.user.ratings).toHaveLength(4);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: 'carol', password: 'password123' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.username).toBe('carol');

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // The old refresh token was rotated out - reusing it should fail now.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('rejects duplicate usernames and wrong passwords', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'dave',
        email: 'dave@example.com',
        password: 'password123',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'dave',
        email: 'dave2@example.com',
        password: 'password123',
      })
      .expect(409);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: 'dave', password: 'wrong-password' })
      .expect(401);
  });

  it('logs in as a guest with no email/password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/guest')
      .expect(200);
    expect(res.body.user.isGuest).toBe(true);
    expect(res.body.user.username).toMatch(/^guest_/);
  });

  it('rejects requests without a token', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });
});
