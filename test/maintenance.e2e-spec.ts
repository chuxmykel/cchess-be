import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAINTENANCE_MESSAGE } from '../src/maintenance/maintenance.service.js';
import {
  createListeningTestApp,
  createTestApp,
  registerUser,
} from './utils/app.js';
import { connect, waitForEvent } from './utils/socket.js';

describe('Maintenance (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('is announced, shown and ended', async () => {
    await http().get('/maintenance').expect(200, { startsAt: null });

    const started = await http()
      .put('/internal/maintenance')
      .send({ minutes: 10 })
      .expect(200);
    expect(started.body.liveGames).toBe(0);
    expect(started.body.secondsToStart).toBeGreaterThan(9 * 60);
    const startsAt = new Date(started.body.startsAt).getTime();
    expect(startsAt - Date.now()).toBeGreaterThan(9 * 60_000);

    await http()
      .get('/maintenance')
      .expect(200, { startsAt: started.body.startsAt });

    await http().delete('/internal/maintenance').expect(204);
    await http().get('/maintenance').expect(200, { startsAt: null });
  });

  it('refuses a notice longer than a day', async () => {
    await http()
      .put('/internal/maintenance')
      .send({ minutes: 24 * 60 + 1 })
      .expect(400);
  });

  it('refuses new live games from the announcement, but not daily ones', async () => {
    const alice = await registerUser(app, 'maint_a');
    const bob = await registerUser(app, 'maint_b');
    // Hours ahead: refused already, though it hasn't begun.
    await http()
      .put('/internal/maintenance')
      .send({ minutes: 120 })
      .expect(200);

    const live = await http()
      .post('/challenges')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({
        opponentUsername: bob.username,
        initialSeconds: 300,
        incrementSeconds: 0,
      })
      .expect(503);
    expect(live.body.message).toBe(MAINTENANCE_MESSAGE);

    const daily = await http()
      .post('/challenges')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({
        opponentUsername: bob.username,
        initialSeconds: 3 * 86_400,
        incrementSeconds: 0,
      })
      .expect(201);
    await http()
      .post(`/challenges/${daily.body.id}/accept`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(201);
  });

  describe('over the socket', () => {
    let baseUrl: string;

    beforeEach(async () => {
      await app.close();
      ({ app, baseUrl } = await createListeningTestApp());
    });

    it('tells players, and drops the seeks waiting as it begins', async () => {
      const carol = await registerUser(app, 'maint_c');
      const socket = await connect(baseUrl, carol.accessToken);
      try {
        socket.emit('matchmaking:seek', {
          initialSeconds: 300,
          incrementSeconds: 0,
        });
        await waitForEvent(socket, 'lobby:stats');

        const pushed = waitForEvent<{ startsAt: string | null }>(
          socket,
          'server:maintenance',
        );
        const refused = waitForEvent<{ message: string }>(
          socket,
          'matchmaking:error',
        );
        await http().put('/internal/maintenance').expect(200);

        expect((await pushed).startsAt).toEqual(expect.any(String));
        expect(await refused).toEqual({ message: MAINTENANCE_MESSAGE });

        socket.emit('matchmaking:seek', {
          initialSeconds: 300,
          incrementSeconds: 0,
        });
        expect(
          await waitForEvent<{ message: string }>(socket, 'matchmaking:error'),
        ).toEqual({ message: MAINTENANCE_MESSAGE });

        const ended = waitForEvent<{ startsAt: string | null }>(
          socket,
          'server:maintenance',
        );
        await http().delete('/internal/maintenance').expect(204);
        expect(await ended).toEqual({ startsAt: null });
      } finally {
        socket.disconnect();
      }
    });
  });
});
