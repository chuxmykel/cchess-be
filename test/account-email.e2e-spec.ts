import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LogMailer } from '../src/mail/log-mailer.js';
import { Mailer } from '../src/mail/mailer.js';
import { createTestApp } from './utils/app.js';

/** The raw token in the last email sent to `to`. */
function tokenMailedTo(mailer: LogMailer, to: string): string {
  const email = mailer.sent.filter((m) => m.to === to).at(-1);
  const match = email?.text.match(/token=([^\s]+)/);
  if (!match) throw new Error(`no link mailed to ${to}`);
  return decodeURIComponent(match[1]);
}

describe('Account email (e2e)', () => {
  let app: INestApplication;
  let mailer: LogMailer;
  let token: string;
  let refreshToken: string;

  const me = () =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  beforeEach(async () => {
    app = await createTestApp();
    mailer = app.get(Mailer) as LogMailer;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'carol',
        email: 'Carol@Example.com',
        password: 'password123',
        acceptTerms: true,
      })
      .expect(201);
    token = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('verifies the address with the link sent at sign-up, once', async () => {
    expect((await me()).body.emailVerified).toBe(false);
    const link = tokenMailedTo(mailer, 'carol@example.com');

    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: link })
      .expect(200, { email: 'carol@example.com' });
    expect((await me()).body.emailVerified).toBe(true);

    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: link })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('resets a forgotten password and signs every device out', async () => {
    await request(app.getHttpServer())
      .post('/auth/password/forgot')
      .send({ email: 'nobody@example.com' })
      .expect(204);
    expect(mailer.sent.some((m) => m.to === 'nobody@example.com')).toBe(false);

    await request(app.getHttpServer())
      .post('/auth/password/forgot')
      .send({ email: 'carol@example.com' })
      .expect(204);
    const link = tokenMailedTo(mailer, 'carol@example.com');

    await request(app.getHttpServer())
      .post('/auth/password/reset')
      .send({ token: link, password: 'brand-new-pass' })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: 'carol', password: 'password123' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ usernameOrEmail: 'carol', password: 'brand-new-pass' })
      .expect(200);
    expect(mailer.sent.at(-1)?.subject).toBe(
      'Your cchess password was changed',
    );
  });

  it('changes the address only once the new one is confirmed', async () => {
    await request(app.getHttpServer())
      .post('/auth/email/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@example.com', password: 'wrong' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/email/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@example.com', password: 'password123' })
      .expect(204);
    expect(mailer.sent.at(-1)).toMatchObject({
      to: 'carol@example.com',
      subject: 'Your cchess email is being changed',
    });
    expect((await me()).body.email).toBe('carol@example.com');

    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: tokenMailedTo(mailer, 'new@example.com') })
      .expect(200);
    const after = (await me()).body;
    expect(after.email).toBe('new@example.com');
    expect(after.emailVerified).toBe(true);
  });
});
