import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, registerUser } from './utils/app.js';

describe('Friends (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends, lists, and accepts a friend request', async () => {
    const eve = await registerUser(app, 'eve_friends');
    const frank = await registerUser(app, 'frank_friends');

    await request(app.getHttpServer())
      .post('/friends/requests')
      .set('Authorization', `Bearer ${eve.accessToken}`)
      .send({ username: frank.username })
      .expect(201);

    const incoming = await request(app.getHttpServer())
      .get('/friends/requests')
      .set('Authorization', `Bearer ${frank.accessToken}`)
      .expect(200);
    expect(incoming.body.incoming).toHaveLength(1);
    const requestId = incoming.body.incoming[0].id;

    await request(app.getHttpServer())
      .post(`/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${frank.accessToken}`)
      .expect(201);

    const eveFriends = await request(app.getHttpServer())
      .get('/friends')
      .set('Authorization', `Bearer ${eve.accessToken}`)
      .expect(200);
    expect(eveFriends.body).toHaveLength(1);
    expect(eveFriends.body[0].username).toBe(frank.username);

    await request(app.getHttpServer())
      .delete(`/friends/${frank.username}`)
      .set('Authorization', `Bearer ${eve.accessToken}`)
      .expect(200);

    const afterRemoval = await request(app.getHttpServer())
      .get('/friends')
      .set('Authorization', `Bearer ${eve.accessToken}`)
      .expect(200);
    expect(afterRemoval.body).toHaveLength(0);
  });

  it("rejects friending yourself and duplicate requests", async () => {
    const grace = await registerUser(app, 'grace_friends');

    await request(app.getHttpServer())
      .post('/friends/requests')
      .set('Authorization', `Bearer ${grace.accessToken}`)
      .send({ username: grace.username })
      .expect(400);

    const heidi = await registerUser(app, 'heidi_friends');
    await request(app.getHttpServer())
      .post('/friends/requests')
      .set('Authorization', `Bearer ${grace.accessToken}`)
      .send({ username: heidi.username })
      .expect(201);
    await request(app.getHttpServer())
      .post('/friends/requests')
      .set('Authorization', `Bearer ${grace.accessToken}`)
      .send({ username: heidi.username })
      .expect(409);
  });
});
