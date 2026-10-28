import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createListeningTestApp,
  makeFriends,
  registerUser,
} from './utils/app.js';
import { connect, waitForEvent } from './utils/socket.js';

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
    await makeFriends(app, ivan, judy);

    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({
        opponentUsername: judy.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;

    const whiteSocket = await connect(baseUrl, ivan.accessToken);
    const blackSocket = await connect(baseUrl, judy.accessToken);

    const whiteState = waitForEvent<{ id: string; turn: string }>(
      whiteSocket,
      'game:state',
    );
    whiteSocket.emit('game:join', { gameId });
    await expect(whiteState).resolves.toMatchObject({ id: gameId, turn: 'w' });

    const blackState = waitForEvent(blackSocket, 'game:state');
    blackSocket.emit('game:join', { gameId });
    await blackState;

    const blackSawMove = waitForEvent<{ move: { san: string }; turn: string }>(
      blackSocket,
      'game:move',
    );
    const whiteSawOwnMove = waitForEvent<{ move: { san: string } }>(
      whiteSocket,
      'game:move',
    );
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });

    await expect(blackSawMove).resolves.toMatchObject({
      move: { san: 'e4' },
      turn: 'b',
    });
    await expect(whiteSawOwnMove).resolves.toMatchObject({
      move: { san: 'e4' },
    });

    // Confirm it actually persisted, not just broadcast.
    const afterMove = await request(app.getHttpServer())
      .get(`/games/${gameId}`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(afterMove.body.moves).toHaveLength(1);
    expect(afterMove.body.turn).toBe('b');

    // Resigning waits until both sides have moved.
    const whiteSawReply = waitForEvent(whiteSocket, 'game:move');
    blackSocket.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await whiteSawReply;

    const bothSeeGameOver = Promise.all([
      waitForEvent(whiteSocket, 'game:over'),
      waitForEvent(blackSocket, 'game:over'),
    ]);
    blackSocket.emit('game:resign', { gameId });
    const [whiteOver, blackOver] = (await bothSeeGameOver) as Array<{
      result: string;
      resultReason: string;
    }>;
    expect(whiteOver.result).toBe('white');
    expect(whiteOver.resultReason).toBe('resignation');
    expect(blackOver).toMatchObject(whiteOver);

    whiteSocket.disconnect();
    blackSocket.disconnect();
  });

  it('rejects an illegal move with a game:error event instead of crashing', async () => {
    const kim = await registerUser(app, 'kim_rt');
    const liam = await registerUser(app, 'liam_rt');
    await makeFriends(app, kim, liam);

    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${kim.accessToken}`)
      .send({
        opponentUsername: liam.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${liam.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;

    const whiteSocket = await connect(baseUrl, kim.accessToken);
    whiteSocket.emit('game:join', { gameId });
    await waitForEvent(whiteSocket, 'game:state');

    const error = waitForEvent<{ gameId: string; message: string }>(
      whiteSocket,
      'game:error',
    );
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e5' });
    await expect(error).resolves.toMatchObject({
      gameId,
      message: 'Illegal move',
    });

    whiteSocket.disconnect();
  });

  it('tells each player whether the other is connected', async () => {
    const pia = await registerUser(app, 'pia_rt');
    const quin = await registerUser(app, 'quin_rt');
    await makeFriends(app, pia, quin);
    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${pia.accessToken}`)
      .send({
        opponentUsername: quin.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${quin.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;
    const quinId = accepted.body.black.id;
    const piaId = accepted.body.white.id;

    const quinSocket = await connect(baseUrl, quin.accessToken);
    const piaSocket = await connect(baseUrl, pia.accessToken);

    const piaJoinedSeenByQuin = waitForEvent(quinSocket, 'game:presence');
    const quinSeenByPia = waitForEvent(piaSocket, 'game:presence');
    piaSocket.emit('game:join', { gameId });

    await expect(piaJoinedSeenByQuin).resolves.toEqual({
      gameId,
      userId: piaId,
      online: true,
    });
    await expect(quinSeenByPia).resolves.toEqual({
      gameId,
      userId: quinId,
      online: true,
    });

    const quinJoinedSeenByPia = waitForEvent(piaSocket, 'game:presence');
    quinSocket.emit('game:join', { gameId });
    await quinJoinedSeenByPia;
    const quinLeft = waitForEvent(piaSocket, 'game:presence');
    quinSocket.disconnect();

    await expect(quinLeft).resolves.toEqual({
      gameId,
      userId: quinId,
      online: false,
    });
    piaSocket.disconnect();
  });

  describe('chat', () => {
    async function startGame(whiteName: string, blackName: string) {
      const white = await registerUser(app, whiteName);
      const black = await registerUser(app, blackName);
      await makeFriends(app, white, black);
      const challenge = await request(app.getHttpServer())
        .post('/challenges')
        .set('Authorization', `Bearer ${white.accessToken}`)
        .send({
          opponentUsername: black.username,
          initialSeconds: 300,
          incrementSeconds: 0,
          color: 'white',
        })
        .expect(201);
      const accepted = await request(app.getHttpServer())
        .post(`/challenges/${challenge.body.id}/accept`)
        .set('Authorization', `Bearer ${black.accessToken}`)
        .expect(201);
      const whiteSocket = await connect(baseUrl, white.accessToken);
      const blackSocket = await connect(baseUrl, black.accessToken);
      return {
        gameId: accepted.body.id as string,
        whiteId: accepted.body.white.id as string,
        blackId: accepted.body.black.id as string,
        white,
        black,
        whiteSocket,
        blackSocket,
      };
    }

    it('sends a message to both players and keeps it for later joins', async () => {
      const { gameId, whiteId, whiteSocket, blackSocket } = await startGame(
        'rita_rt',
        'sven_rt',
      );

      const seenByBlack = waitForEvent(blackSocket, 'game:chat');
      const seenByWhite = waitForEvent(whiteSocket, 'game:chat');
      whiteSocket.emit('game:chat', { gameId, text: '  good luck!  ' });

      const expected = { gameId, userId: whiteId, text: 'good luck!' };
      await expect(seenByBlack).resolves.toMatchObject(expected);
      await expect(seenByWhite).resolves.toMatchObject(expected);

      const history = waitForEvent<{ messages: unknown[] }>(
        blackSocket,
        'game:chatHistory',
      );
      blackSocket.emit('game:chatHistory', { gameId });
      await expect(history).resolves.toMatchObject({
        gameId,
        messages: [expected],
      });

      whiteSocket.disconnect();
      blackSocket.disconnect();
    });

    it('notes draws offered, declined and accepted, kept in the history', async () => {
      const {
        gameId,
        whiteId,
        blackId,
        white,
        black,
        whiteSocket,
        blackSocket,
      } = await startGame('wade_rt', 'xena_rt');
      const move = (token: string, from: string, to: string) =>
        request(app.getHttpServer())
          .post(`/games/${gameId}/moves`)
          .set('Authorization', `Bearer ${token}`)
          .send({ from, to })
          .expect(201);

      // Not before both sides have moved.
      const tooEarly = waitForEvent<{ message: string }>(
        whiteSocket,
        'game:error',
      );
      whiteSocket.emit('game:drawOffer', { gameId });
      expect((await tooEarly).message).toBe(
        'Too early to offer a draw - abort the game instead',
      );
      await move(white.accessToken, 'e2', 'e4');
      await move(black.accessToken, 'e7', 'e5');

      const noted = async (
        act: () => void,
        expected: { userId: string; kind: string },
      ) => {
        const seen = waitForEvent(blackSocket, 'game:chat');
        act();
        await expect(seen).resolves.toMatchObject({
          gameId,
          text: '',
          ...expected,
        });
      };
      await noted(() => whiteSocket.emit('game:drawOffer', { gameId }), {
        userId: whiteId,
        kind: 'draw-offered',
      });
      await noted(
        () => blackSocket.emit('game:drawRespond', { gameId, accept: false }),
        { userId: blackId, kind: 'draw-declined' },
      );
      await noted(() => whiteSocket.emit('game:drawOffer', { gameId }), {
        userId: whiteId,
        kind: 'draw-offered',
      });
      await noted(
        () => blackSocket.emit('game:drawRespond', { gameId, accept: true }),
        { userId: blackId, kind: 'draw-accepted' },
      );

      const history = waitForEvent<{ messages: { kind: string }[] }>(
        whiteSocket,
        'game:chatHistory',
      );
      whiteSocket.emit('game:chatHistory', { gameId });
      expect((await history).messages.map((each) => each.kind)).toEqual([
        'draw-offered',
        'draw-declined',
        'draw-offered',
        'draw-accepted',
      ]);

      whiteSocket.disconnect();
      blackSocket.disconnect();
    });

    it('keeps how far each player has read the chat', async () => {
      const { gameId, whiteSocket, blackSocket } = await startGame(
        'yuri_rt',
        'zola_rt',
      );
      const historyFor = async (socket: typeof whiteSocket) => {
        const history = waitForEvent<{ readAt: string | null }>(
          socket,
          'game:chatHistory',
        );
        socket.emit('game:chatHistory', { gameId });
        return history;
      };
      expect((await historyFor(blackSocket)).readAt).toBeNull();

      const before = Date.now();
      blackSocket.emit('game:chatRead', { gameId });
      // Read back once the mark has landed.
      let readAt: string | null = null;
      for (let tries = 0; tries < 20 && !readAt; tries += 1) {
        readAt = (await historyFor(blackSocket)).readAt;
      }

      expect(new Date(readAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
      // Only black has read it.
      expect((await historyFor(whiteSocket)).readAt).toBeNull();

      whiteSocket.disconnect();
      blackSocket.disconnect();
    });

    it('rejects an empty message, and one from outside the game', async () => {
      const { gameId, whiteSocket, blackSocket } = await startGame(
        'tess_rt',
        'umar_rt',
      );
      const outsider = await registerUser(app, 'vera_rt');
      const outsiderSocket = await connect(baseUrl, outsider.accessToken);

      const emptyRejected = waitForEvent(whiteSocket, 'game:error');
      whiteSocket.emit('game:chat', { gameId, text: '   ' });
      await expect(emptyRejected).resolves.toMatchObject({
        gameId,
        message: 'Message is empty',
      });

      const outsiderRejected = waitForEvent(outsiderSocket, 'game:error');
      outsiderSocket.emit('game:chat', { gameId, text: 'hi' });
      await expect(outsiderRejected).resolves.toMatchObject({
        message: 'You are not a player in this game',
      });

      whiteSocket.disconnect();
      blackSocket.disconnect();
      outsiderSocket.disconnect();
    });

    it('slows down a player sending too many messages', async () => {
      const { gameId, whiteSocket, blackSocket } = await startGame(
        'wade_rt',
        'xena_rt',
      );

      const rejected = waitForEvent(whiteSocket, 'game:error');
      const delivered = new Promise<void>((resolve) => {
        let count = 0;
        blackSocket.on('game:chat', () => {
          count += 1;
          if (count === 5) resolve();
        });
      });
      for (let i = 0; i < 6; i++) {
        whiteSocket.emit('game:chat', { gameId, text: `message ${i}` });
      }

      await expect(rejected).resolves.toMatchObject({
        message: 'Slow down - too many messages',
      });
      await delivered;
      whiteSocket.disconnect();
      blackSocket.disconnect();
    });
  });

  describe('lobby stats', () => {
    const fiveMinutes = { initialSeconds: 300, incrementSeconds: 0 };

    it('sends players online and games in play once a seek is queued', async () => {
      const mona = await registerUser(app, 'mona_rt');
      const nils = await registerUser(app, 'nils_rt');
      const idleSocket = await connect(baseUrl, nils.accessToken);
      const seekingSocket = await connect(baseUrl, mona.accessToken);

      const stats = waitForEvent(seekingSocket, 'lobby:stats');
      seekingSocket.emit('matchmaking:seek', fiveMinutes);

      await expect(stats).resolves.toEqual({
        playersOnline: 2,
        gamesInPlay: 0,
      });
      seekingSocket.disconnect();
      idleSocket.disconnect();
    });

    it('keeps sending stats while the seek waits', async () => {
      const otto = await registerUser(app, 'otto_rt');
      const socket = await connect(baseUrl, otto.accessToken);

      const first = waitForEvent(socket, 'lobby:stats');
      socket.emit('matchmaking:seek', fiveMinutes);
      await first;

      await expect(
        waitForEvent(socket, 'lobby:stats', 7000),
      ).resolves.toMatchObject({ playersOnline: 1 });
      socket.disconnect();
    }, 10_000);
  });
});
