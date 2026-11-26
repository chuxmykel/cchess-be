import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TERMS_VERSION } from '../src/legal/legal.js';
import { createTestApp } from './utils/app.js';

describe('Web pages and app config (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('tells the app the oldest version supported and the terms in force', async () => {
    const res = await request(app.getHttpServer())
      .get('/app/config')
      .expect(200);
    expect(res.body).toMatchObject({
      minimumVersion: '0.0.0',
      termsVersion: TERMS_VERSION,
      supportEmail: 'support@chux.dev',
    });
    expect(res.body.privacyUrl).toMatch(/\/legal\/privacy$/);
  });

  it('serves the legal pages and the pages behind email links, signed out', async () => {
    for (const [path, words] of [
      ['/legal/privacy', 'Privacy policy'],
      ['/legal/terms', 'Terms of use'],
      ['/account/delete', 'Delete your cchess account'],
      ['/app/verify-email?token=x', 'Confirm your email'],
      ['/app/reset-password?token=x', 'Set a new password'],
    ]) {
      const res = await request(app.getHttpServer()).get(path).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain(words);
    }
  });

  it('serves no app-link association until the app is set up', async () => {
    await request(app.getHttpServer())
      .get('/.well-known/apple-app-site-association')
      .expect(404);
    await request(app.getHttpServer())
      .get('/.well-known/assetlinks.json')
      .expect(200, []);
  });
});
