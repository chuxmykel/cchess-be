import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

describe('Profanity filter (e2e)', () => {
  let app: INestApplication;
  let ana: RegisteredUser;
  let bob: RegisteredUser;

  beforeEach(async () => {
    app = await createTestApp();
    ana = await registerUser(app, 'ana');
    bob = await registerUser(app, 'bob');
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses an obscene username or bio', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'dickhead99',
        email: 'd@example.com',
        password: 'password123',
        acceptTerms: true,
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${ana.accessToken}`)
      .send({ bio: 'what a shit app' })
      .expect(400);
  });

  it('masks obscenities in a direct message', async () => {
    await makeFriends(app, ana, bob);
    const sent = await request(app.getHttpServer())
      .post(`/messages/${bob.username}`)
      .set('Authorization', `Bearer ${ana.accessToken}`)
      .send({ text: 'you fucking idiot' })
      .expect(201);
    expect(sent.body.text).toBe('you ****ing idiot');
  });
});
