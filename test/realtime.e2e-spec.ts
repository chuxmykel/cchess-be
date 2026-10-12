import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createListeningTestApp, registerUser } from './utils/app.js';

function connect(baseUrl: string, accessToken: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { token: accessToken }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Realtime gateway (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeEach(async () => {
    ({ app, baseUrl } = await createListeningTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a connection with no/invalid token', async () => {
    // The Socket.IO/Engine.IO handshake completes (so the client does see
    // "connect") before our own handleConnection gets a chance to verify
    // the JWT and force-disconnect it - so the rejection is a near-immediate
    // "disconnect" with reason "io server disconnect", not a connect_error
    // at the transport level. The listener has to be attached before
    // "connect" resolves, since the server can disconnect it right away.
    const socket = io(baseUrl, {
      auth: { token: 'not-a-real-token' },
      transports: ['websocket'],
      reconnection: false,
    });
    const disconnectReason = await waitForEvent<string>(socket, 'disconnect');
    expect(disconnectReason).toBe('io server disconnect');
  });

  it('authenticates, joins a game room, and broadcasts moves to both players', async () => {
    const ivan = await registerUser(app, 'ivan_rt');
    const judy = await registerUser(app, 'judy_rt');

    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ opponentUsername: judy.username, minutes: 5, incrementSeconds: 0, color: 'white' })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;

    const whiteSocket = await connect(baseUrl, ivan.accessToken);
    const blackSocket = await connect(baseUrl, judy.accessToken);

    const whiteState = waitForEvent<{ id: string; turn: string }>(whiteSocket, 'game:state');
    whiteSocket.emit('game:join', { gameId });
    await expect(whiteState).resolves.toMatchObject({ id: gameId, turn: 'w' });

    const blackState = waitForEvent(blackSocket, 'game:state');
    blackSocket.emit('game:join', { gameId });
    await blackState;

    const blackSawMove = waitForEvent<{ move: { san: string }; turn: string }>(blackSocket, 'game:move');
    const whiteSawOwnMove = waitForEvent<{ move: { san: string } }>(whiteSocket, 'game:move');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });

    await expect(blackSawMove).resolves.toMatchObject({ move: { san: 'e4' }, turn: 'b' });
    await expect(whiteSawOwnMove).resolves.toMatchObject({ move: { san: 'e4' } });

    // Confirm it actually persisted, not just broadcast.
    const afterMove = await request(app.getHttpServer())
      .get(`/games/${gameId}`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(afterMove.body.moves).toHaveLength(1);
    expect(afterMove.body.turn).toBe('b');

    const bothSeeGameOver = Promise.all([waitForEvent(whiteSocket, 'game:over'), waitForEvent(blackSocket, 'game:over')]);
    blackSocket.emit('game:resign', { gameId });
    const [whiteOver, blackOver] = (await bothSeeGameOver) as Array<{ result: string; resultReason: string }>;
    expect(whiteOver.result).toBe('white');
    expect(whiteOver.resultReason).toBe('resignation');
    expect(blackOver).toMatchObject(whiteOver);

    whiteSocket.disconnect();
    blackSocket.disconnect();
  });

  it('rejects an illegal move with a game:error event instead of crashing', async () => {
    const kim = await registerUser(app, 'kim_rt');
    const liam = await registerUser(app, 'liam_rt');

    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${kim.accessToken}`)
      .send({ opponentUsername: liam.username, minutes: 5, incrementSeconds: 0, color: 'white' })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${liam.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;

    const whiteSocket = await connect(baseUrl, kim.accessToken);
    whiteSocket.emit('game:join', { gameId });
    await waitForEvent(whiteSocket, 'game:state');

    const error = waitForEvent<{ gameId: string; message: string }>(whiteSocket, 'game:error');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e5' });
    await expect(error).resolves.toMatchObject({ gameId, message: 'Illegal move' });

    whiteSocket.disconnect();
  });
});
