import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LogMailer } from '../src/mail/log-mailer.js';
import { Mailer } from '../src/mail/mailer.js';
import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

describe('Reports and moderation (e2e)', () => {
  let app: INestApplication;
  let mailer: LogMailer;
  let ana: RegisteredUser;
  let bob: RegisteredUser;

  const as = (user: RegisteredUser) => {
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${user.accessToken}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string) => auth(server().post(path)),
    };
  };

  beforeEach(async () => {
    app = await createTestApp();
    mailer = app.get(Mailer) as LogMailer;
    ana = await registerUser(app, 'ana');
    bob = await registerUser(app, 'bob');
    await makeFriends(app, ana, bob);
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports a direct message, keeping its words, and mails support', async () => {
    const sent = await as(bob)
      .post(`/messages/${ana.username}`)
      .send({ text: 'you are terrible' })
      .expect(201);

    await as(ana)
      .post('/reports')
      .send({
        username: bob.username,
        reason: 'abuse',
        messageId: sent.body.id,
      })
      .expect(204);

    const email = mailer.sent.at(-1);
    expect(email?.to).toBe('support@chux.dev');
    expect(email?.subject).toBe(`[cchess report] abuse: ${bob.username}`);
    expect(email?.text).toContain('"you are terrible"');

    const open = await request(app.getHttpServer())
      .get('/internal/reports')
      .expect(200);
    expect(open.body).toHaveLength(1);
    expect(open.body[0]).toMatchObject({
      reporter: ana.username,
      reported: bob.username,
      messageText: 'you are terrible',
    });
  });

  it("refuses a message the reported player didn't send you, and yourself", async () => {
    const mine = await as(ana)
      .post(`/messages/${bob.username}`)
      .send({ text: 'hello' })
      .expect(201);
    await as(ana)
      .post('/reports')
      .send({ username: bob.username, reason: 'spam', messageId: mine.body.id })
      .expect(404);
    await as(ana)
      .post('/reports')
      .send({ username: ana.username, reason: 'spam' })
      .expect(400);
  });

  it('suspends an account until unsuspended', async () => {
    await request(app.getHttpServer())
      .post(`/internal/users/${bob.username}/suspend`)
      .expect(204);
    await as(bob).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: bob.username, password: 'password123' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/internal/users/${bob.username}/unsuspend`)
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: bob.username, password: 'password123' })
      .expect(200);
  });
});
