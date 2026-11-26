import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DirectMessage } from '../src/messages/entities/direct-message.entity.js';
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

  it('keeps a direct message as written, masking it wherever it goes out', async () => {
    await makeFriends(app, ana, bob);
    const as = (user: RegisteredUser) => (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    const sent = await request(app.getHttpServer())
      .post(`/messages/${bob.username}`)
      .set('Authorization', `Bearer ${ana.accessToken}`)
      .send({ text: 'you fucking idiot' })
      .expect(201);
    expect(sent.body.text).toBe('you ****ing idiot');

    const history = await as(bob)(`/messages/${ana.username}`);
    expect(history.body[0].text).toBe('you ****ing idiot');
    const inbox = await as(bob)('/messages');
    expect(inbox.body[0].lastMessage.text).toBe('you ****ing idiot');

    const kept = await app
      .get(DataSource)
      .getRepository(DirectMessage)
      .findOneByOrFail({ id: sent.body.id });
    expect(kept.text).toBe('you fucking idiot');
  });

  it("gives a report the message's own words", async () => {
    await makeFriends(app, ana, bob);
    const sent = await request(app.getHttpServer())
      .post(`/messages/${bob.username}`)
      .set('Authorization', `Bearer ${ana.accessToken}`)
      .send({ text: 'you fucking idiot' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/reports')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({
        username: ana.username,
        reason: 'abuse',
        messageId: sent.body.id,
      })
      .expect(204);

    const open = await request(app.getHttpServer())
      .get('/internal/reports')
      .expect(200);
    expect(open.body[0].messageText).toBe('you fucking idiot');
  });
});
