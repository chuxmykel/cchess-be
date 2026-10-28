import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createListeningTestApp,
  makeFriends,
  registerUser,
  type RegisteredUser,
} from './utils/app.js';
import { connect, waitForEvent } from './utils/socket.js';

describe('Friends, profiles, challenges and messages (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    ({ app, baseUrl } = await createListeningTestApp());
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    delete process.env.CHALLENGE_TTL_MS;
    delete process.env.GAME_CHAT_WINDOW_MS;
    await app.close();
  });

  async function connectAs(user: RegisteredUser): Promise<Socket> {
    const socket = await connect(baseUrl, user.accessToken);
    sockets.push(socket);
    return socket;
  }

  function as(user: RegisteredUser) {
    const server = app.getHttpServer();
    const auth = (test: request.Test) =>
      test.set('Authorization', `Bearer ${user.accessToken}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string) => auth(request(server).post(url)),
      delete: (url: string) => auth(request(server).delete(url)),
    };
  }

  /** A 5+0 game between friends, with `white` as white. */
  async function startGame(
    white: RegisteredUser,
    black: RegisteredUser,
    options: { rated?: boolean } = {},
  ): Promise<string> {
    const challenge = await as(white)
      .post('/challenges')
      .send({
        opponentUsername: black.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
        ...options,
      })
      .expect(201);
    const accepted = await as(black)
      .post(`/challenges/${challenge.body.id}/accept`)
      .expect(201);
    return accepted.body.id;
  }

  async function playAndResign(
    white: RegisteredUser,
    black: RegisteredUser,
  ): Promise<string> {
    const gameId = await startGame(white, black);
    await as(white)
      .post(`/games/${gameId}/moves`)
      .send({ from: 'e2', to: 'e4' })
      .expect(201);
    await as(black)
      .post(`/games/${gameId}/moves`)
      .send({ from: 'e7', to: 'e5' })
      .expect(201);
    await as(black).post(`/games/${gameId}/resign`).expect(200);
    return gameId;
  }

  describe('friends', () => {
    it('lists friends with their ratings, presence and game', async () => {
      const ann = await registerUser(app, 'ann_social');
      const ben = await registerUser(app, 'ben_social');
      await makeFriends(app, ann, ben);

      const before = await as(ann).get('/friends').expect(200);
      expect(before.body).toHaveLength(1);
      expect(before.body[0]).toMatchObject({
        username: ben.username,
        online: false,
        playingGameId: null,
      });
      expect(before.body[0].ratings).toHaveLength(4);

      await connectAs(ben);
      const gameId = await startGame(ann, ben);

      const after = await as(ann).get('/friends').expect(200);
      expect(after.body[0]).toMatchObject({
        online: true,
        playingGameId: gameId,
      });
    });

    it('pushes requests, their outcome and removals to both sides', async () => {
      const cal = await registerUser(app, 'cal_social');
      const dee = await registerUser(app, 'dee_social');
      const calSocket = await connectAs(cal);
      const deeSocket = await connectAs(dee);

      const received = waitForEvent<{ id: string; user: { username: string } }>(
        deeSocket,
        'friend:requestReceived',
      );
      const sent = await as(cal)
        .post('/friends/requests')
        .send({ username: dee.username })
        .expect(201);
      expect((await received).user.username).toBe(cal.username);

      const resolved = waitForEvent<{ id: string }>(
        calSocket,
        'friend:requestResolved',
      );
      await as(dee)
        .post(`/friends/requests/${sent.body.id}/decline`)
        .expect(201);
      expect((await resolved).id).toBe(sent.body.id);

      await makeFriends(app, cal, dee);
      const removed = waitForEvent<{ userIds: string[] }>(
        deeSocket,
        'friend:removed',
      );
      await as(cal).delete(`/friends/${dee.username}`).expect(200);
      expect((await removed).userIds).toContain(cal.userId);
    });

    it('tells friends when someone comes online and goes offline', async () => {
      const eli = await registerUser(app, 'eli_social');
      const fay = await registerUser(app, 'fay_social');
      await makeFriends(app, eli, fay);
      const eliSocket = await connectAs(eli);

      const online = waitForEvent<{ userId: string; online: boolean }>(
        eliSocket,
        'friend:status',
      );
      const faySocket = await connectAs(fay);
      expect(await online).toMatchObject({ userId: fay.userId, online: true });

      const offline = waitForEvent<{ userId: string; online: boolean }>(
        eliSocket,
        'friend:status',
      );
      faySocket.disconnect();
      expect(await offline).toMatchObject({
        userId: fay.userId,
        online: false,
      });
    });
  });

  describe('searching for players', () => {
    it('finds registered players by part of their name, closest first', async () => {
      const viewer = await registerUser(app, 'srch_viewer');
      const amy = await registerUser(app, 'srch_amy');
      const am = await registerUser(app, 'srch_am');
      const amz = await registerUser(app, 'xsrch_amz');
      await registerUser(app, 'srchqam');
      const usernamesFor = async (search: string) =>
        (
          await as(viewer)
            .get(`/users?search=${encodeURIComponent(search)}`)
            .expect(200)
        ).body.map((user: { username: string }) => user.username);

      expect(await usernamesFor('SRCH_AM')).toEqual([
        am.username,
        amy.username,
        amz.username,
      ]);
      expect(await usernamesFor(am.username)).toEqual([
        am.username,
        amy.username,
      ]);
      expect(await usernamesFor('srch_view')).toEqual([]);
    });

    it('leaves out guests and refuses an empty search', async () => {
      const viewer = await registerUser(app, 'srch_guests');
      await request(app.getHttpServer()).post('/auth/guest').expect(200);

      const found = await as(viewer).get('/users?search=guest_').expect(200);

      expect(
        found.body.filter((user: { username: string }) =>
          user.username.startsWith('guest_'),
        ),
      ).toEqual([]);
      await as(viewer).get('/users?search=').expect(400);
    });
  });

  describe('profiles', () => {
    it("describes the viewer's friendship with the user", async () => {
      const gus = await registerUser(app, 'gus_social');
      const hal = await registerUser(app, 'hal_social');
      const statusOf = async (viewer: RegisteredUser, username: string) =>
        (await as(viewer).get(`/users/${username}`).expect(200)).body
          .friendship;

      expect(await statusOf(gus, hal.username)).toEqual({
        status: 'none',
        requestId: null,
      });
      expect((await statusOf(gus, gus.username)).status).toBe('self');

      const sent = await as(gus)
        .post('/friends/requests')
        .send({ username: hal.username })
        .expect(201);
      expect(await statusOf(gus, hal.username)).toEqual({
        status: 'outgoing',
        requestId: sent.body.id,
      });
      expect(await statusOf(hal, gus.username)).toEqual({
        status: 'incoming',
        requestId: sent.body.id,
      });

      await as(hal)
        .post(`/friends/requests/${sent.body.id}/accept`)
        .expect(201);
      expect((await statusOf(gus, hal.username)).status).toBe('friends');
    });

    it("counts and lists the user's friends, newest first", async () => {
      const kim = await registerUser(app, 'kim_social');
      const lee = await registerUser(app, 'lee_social');
      const max = await registerUser(app, 'max_social');
      const viewer = await registerUser(app, 'ned_social');
      await makeFriends(app, kim, lee);
      await makeFriends(app, max, kim);

      const profile = await as(viewer)
        .get(`/users/${kim.username}`)
        .expect(200);
      expect(profile.body.friendsCount).toBe(2);
      const friends = await as(viewer)
        .get(`/users/${kim.username}/friends`)
        .expect(200);
      expect(
        friends.body.map((friend: { username: string }) => friend.username),
      ).toEqual([max.username, lee.username]);
      expect(friends.body[0]).toMatchObject({
        online: false,
        playingGameId: null,
        friendsSince: expect.any(String),
      });
      const none = await as(viewer)
        .get(`/users/${viewer.username}/friends`)
        .expect(200);
      expect(none.body).toEqual([]);
      await as(viewer).get('/users/nobody_here/friends').expect(404);
    });

    it("totals the user's games, score, activity and game list", async () => {
      const ida = await registerUser(app, 'ida_social');
      const jon = await registerUser(app, 'jon_social');
      await makeFriends(app, ida, jon);
      const gameId = await playAndResign(ida, jon);

      const profile = await as(ida).get(`/users/${jon.username}`).expect(200);
      expect(profile.body).toMatchObject({
        username: jon.username,
        gamesPlayed: 1,
        online: false,
        playingGameId: null,
        score: { wins: 1, draws: 0, losses: 0 },
      });
      expect(profile.body.timePlayedMs).toBeGreaterThanOrEqual(0);
      const own = await as(ida).get(`/users/${ida.username}`).expect(200);
      expect(own.body.score).toBeNull();

      const activity = await as(ida)
        .get(`/users/${jon.username}/activity`)
        .expect(200);
      expect(activity.body).toEqual([
        expect.objectContaining({
          category: 'blitz',
          games: 1,
          wins: 0,
          draws: 0,
          losses: 1,
        }),
      ]);

      const games = await as(ida)
        .get(`/users/${jon.username}/games?limit=5`)
        .expect(200);
      expect(games.body).toHaveLength(1);
      expect(games.body[0]).toMatchObject({
        id: gameId,
        result: 'loss',
        playedAsWhite: false,
        opponentUsername: ida.username,
      });
    });

    it("sums up a user's rating and results in one category", async () => {
      const kim = await registerUser(app, 'kim_social');
      const lou = await registerUser(app, 'lou_social');
      const won = await playAndResign(kim, lou);
      const lost = await playAndResign(lou, kim);

      const stats = await as(lou)
        .get(`/users/${kim.username}/ratings/blitz?period=1w`)
        .expect(200);

      expect(stats.body).toMatchObject({
        period: '1w',
        rating: { category: 'blitz', gamesPlayed: 2 },
        games: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        bestWin: { gameId: won, opponentUsername: lou.username },
        worstLoss: { gameId: lost, opponentUsername: lou.username },
        longestWinStreak: 1,
        longestLosingStreak: 1,
      });
      const { history, ratingChange, rating } = stats.body;
      // The rating going in, then each day's close - one day, unless the
      // two games happen to straddle UTC midnight.
      expect(history[0].rating).toBe(1500);
      expect(history.length).toBeLessThanOrEqual(3);
      expect(history.at(-1).rating).toBe(rating.rating);
      expect(ratingChange).toBe(history.at(-1).rating - history[0].rating);

      const bullet = await as(lou)
        .get(`/users/${kim.username}/ratings/bullet`)
        .expect(200);
      expect(bullet.body).toMatchObject({
        period: '1m',
        games: 0,
        history: [],
        ratingChange: null,
      });
    });

    it('refuses an unknown category or period', async () => {
      const max = await registerUser(app, 'max_social');

      await as(max).get(`/users/${max.username}/ratings/chess960`).expect(400);
      await as(max)
        .get(`/users/${max.username}/ratings/blitz?period=2w`)
        .expect(400);
    });

    it('still answers /users/me with your own account', async () => {
      const kai = await registerUser(app, 'kai_social');

      const me = await as(kai).get('/users/me').expect(200);

      expect(me.body.username).toBe(kai.username);
      expect(me.body.email).toBe(`${kai.username}@example.com`);
    });
  });

  describe('challenges', () => {
    it("won't start a second game while one is in progress", async () => {
      const nia = await registerUser(app, 'nia_social');
      const ola = await registerUser(app, 'ola_social');
      const pat = await registerUser(app, 'pat_social');
      await startGame(nia, ola);

      const seek = await as(nia)
        .post('/matchmaking/seek')
        .send({ initialSeconds: 300, incrementSeconds: 0 })
        .expect(409);
      expect(seek.body.message).toBe('Finish your game in progress first');
      await as(nia)
        .post('/challenges')
        .send({
          opponentUsername: pat.username,
          initialSeconds: 300,
          incrementSeconds: 0,
        })
        .expect(409);
      const fromPat = await as(pat)
        .post('/challenges')
        .send({
          opponentUsername: nia.username,
          initialSeconds: 300,
          incrementSeconds: 0,
        })
        .expect(201);
      await as(nia).post(`/challenges/${fromPat.body.id}/accept`).expect(409);
    });

    it("won't accept a challenge from someone who's since started a game", async () => {
      const rex = await registerUser(app, 'rex_social');
      const sam = await registerUser(app, 'sam_social');
      const tia = await registerUser(app, 'tia_social');
      const challenge = await as(rex)
        .post('/challenges')
        .send({
          opponentUsername: sam.username,
          initialSeconds: 300,
          incrementSeconds: 0,
        })
        .expect(201);
      await startGame(rex, tia);

      const accepted = await as(sam)
        .post(`/challenges/${challenge.body.id}/accept`)
        .expect(409);

      expect(accepted.body.message).toBe(
        `${rex.username} is in the middle of a game`,
      );
    });

    it("lets anyone challenge a player they aren't friends with", async () => {
      const lea = await registerUser(app, 'lea_social');
      const max = await registerUser(app, 'max_social');
      const maxSocket = await connectAs(max);
      const received = waitForEvent<{ challenger: { username: string } }>(
        maxSocket,
        'challenge:received',
      );

      await as(lea)
        .post('/challenges')
        .send({
          opponentUsername: max.username,
          initialSeconds: 300,
          incrementSeconds: 0,
        })
        .expect(201);

      expect((await received).challenger.username).toBe(lea.username);
    });

    it('starts a casual game when the challenge is casual', async () => {
      const ned = await registerUser(app, 'ned_social');
      const ola = await registerUser(app, 'ola_social');
      await makeFriends(app, ned, ola);

      const gameId = await startGame(ned, ola, { rated: false });

      const game = await as(ned).get(`/games/${gameId}`).expect(200);
      expect(game.body.rated).toBe(false);
    });

    it('replaces a pending challenge to the same friend', async () => {
      const pam = await registerUser(app, 'pam_social');
      const quy = await registerUser(app, 'quy_social');
      await makeFriends(app, pam, quy);
      const send = (initialSeconds: number) =>
        as(pam)
          .post('/challenges')
          .send({
            opponentUsername: quy.username,
            initialSeconds,
            incrementSeconds: 0,
          })
          .expect(201);

      const first = await send(300);
      const second = await send(600);

      const list = await as(quy).get('/challenges').expect(200);
      expect(list.body.incoming.map((c: { id: string }) => c.id)).toEqual([
        second.body.id,
      ]);
      await as(quy).post(`/challenges/${first.body.id}/accept`).expect(409);
    });

    it('tells the challenger when the challenge is declined', async () => {
      const ted = await registerUser(app, 'ted_social');
      const una = await registerUser(app, 'una_social');
      await makeFriends(app, ted, una);
      const tedSocket = await connectAs(ted);
      const challenge = await as(ted)
        .post('/challenges')
        .send({
          opponentUsername: una.username,
          initialSeconds: 300,
          incrementSeconds: 0,
        })
        .expect(201);

      const resolved = waitForEvent<{ id: string; status: string }>(
        tedSocket,
        'challenge:resolved',
      );
      await as(una)
        .post(`/challenges/${challenge.body.id}/decline`)
        .expect(201);

      expect(await resolved).toMatchObject({
        id: challenge.body.id,
        status: 'declined',
      });
    });

    it('expires an unanswered challenge', async () => {
      process.env.CHALLENGE_TTL_MS = '300';
      const ray = await registerUser(app, 'ray_social');
      const sue = await registerUser(app, 'sue_social');
      await makeFriends(app, ray, sue);
      const raySocket = await connectAs(ray);

      const expired = waitForEvent<{ status: string }>(
        raySocket,
        'challenge:resolved',
      );
      const challenge = await as(ray)
        .post('/challenges')
        .send({
          opponentUsername: sue.username,
          initialSeconds: 300,
          incrementSeconds: 0,
        })
        .expect(201);
      expect(challenge.body.expiresAt).toBeDefined();

      expect((await expired).status).toBe('expired');
      const list = await as(sue).get('/challenges').expect(200);
      expect(list.body.incoming).toEqual([]);
      await as(sue).post(`/challenges/${challenge.body.id}/accept`).expect(409);
    });
  });

  describe('direct messages', () => {
    it('only lets friends message each other', async () => {
      const tom = await registerUser(app, 'tom_social');
      const uma = await registerUser(app, 'uma_social');

      await as(tom)
        .post(`/messages/${uma.username}`)
        .send({ text: 'hi' })
        .expect(403);
    });

    it('sends, pushes, counts unread, marks read and clears', async () => {
      const val = await registerUser(app, 'val_social');
      const wes = await registerUser(app, 'wes_social');
      await makeFriends(app, val, wes);
      const wesSocket = await connectAs(wes);

      const pushed = waitForEvent<{ text: string; senderId: string }>(
        wesSocket,
        'dm:message',
      );
      await as(val)
        .post(`/messages/${wes.username}`)
        .send({ text: '  first  ' })
        .expect(201);
      expect(await pushed).toMatchObject({
        text: 'first',
        senderId: val.userId,
      });
      await as(val)
        .post(`/messages/${wes.username}`)
        .send({ text: 'second' })
        .expect(201);

      expect((await as(wes).get('/messages/unread').expect(200)).body).toEqual([
        { userId: val.userId, count: 2 },
      ]);
      const history = await as(wes)
        .get(`/messages/${val.username}`)
        .expect(200);
      expect(history.body.map((m: { text: string }) => m.text)).toEqual([
        'second',
        'first',
      ]);

      await as(wes).post(`/messages/${val.username}/read`).expect(201);
      expect((await as(wes).get('/messages/unread').expect(200)).body).toEqual(
        [],
      );

      await as(wes).delete(`/messages/${val.username}`).expect(200);
      expect(
        (await as(wes).get(`/messages/${val.username}`).expect(200)).body,
      ).toEqual([]);
      expect(
        (await as(val).get(`/messages/${wes.username}`).expect(200)).body,
      ).toHaveLength(2);
    });

    it('refuses an empty or overlong message', async () => {
      const xia = await registerUser(app, 'xia_social');
      const yan = await registerUser(app, 'yan_social');
      await makeFriends(app, xia, yan);

      await as(xia)
        .post(`/messages/${yan.username}`)
        .send({ text: '   ' })
        .expect(400);
      await as(xia)
        .post(`/messages/${yan.username}`)
        .send({ text: 'x'.repeat(501) })
        .expect(400);
    });
  });

  describe('watching a game', () => {
    it("sends a spectator the game's state, moves and result", async () => {
      const zed = await registerUser(app, 'zed_social');
      const amy = await registerUser(app, 'amy_social');
      const bob = await registerUser(app, 'bob_social');
      await makeFriends(app, zed, amy);
      const gameId = await startGame(zed, amy);
      const watcher = await connectAs(bob);

      const state = waitForEvent<{ id: string }>(watcher, 'game:state');
      watcher.emit('game:watch', { gameId });
      expect((await state).id).toBe(gameId);

      const move = waitForEvent<{ move: { san: string } }>(
        watcher,
        'game:move',
      );
      await as(zed)
        .post(`/games/${gameId}/moves`)
        .send({ from: 'e2', to: 'e4' })
        .expect(201);
      expect((await move).move.san).toBe('e4');

      const over = waitForEvent<{ status: string }>(watcher, 'game:over');
      await as(amy).post(`/games/${gameId}/abort`).expect(200);
      expect((await over).status).toBe('aborted');
    });
  });

  describe('rematches', () => {
    type CreatedGame = {
      id: string;
      white: { username: string };
      black: { username: string };
      rematchOfId: string | null;
      series: { white: number; black: number } | null;
      initialSeconds: number;
      rated: boolean;
    };

    it('starts once both players offer, colors swapped, keeping score', async () => {
      const uma = await registerUser(app, 'uma_social');
      const vic = await registerUser(app, 'vic_social');
      const umaSocket = await connectAs(uma);
      const vicSocket = await connectAs(vic);
      const first = await playAndResign(uma, vic);

      const offered = waitForEvent<{ gameId: string; by: string }>(
        vicSocket,
        'game:rematchOffered',
      );
      umaSocket.emit('game:rematchOffer', { gameId: first });
      expect(await offered).toEqual({ gameId: first, by: 'white' });

      const created = waitForEvent<CreatedGame>(umaSocket, 'game:created');
      vicSocket.emit('game:rematchOffer', { gameId: first });
      const rematch = await created;

      expect(rematch).toMatchObject({
        white: { username: vic.username },
        black: { username: uma.username },
        rematchOfId: first,
        series: { white: 0, black: 1 },
        initialSeconds: 300,
        rated: true,
      });
      const old = await as(uma).get(`/games/${first}`).expect(200);
      expect(old.body).toMatchObject({
        rematchGameId: rematch.id,
        rematchOfferedBy: null,
      });

      await as(uma).post(`/games/${rematch.id}/abort`).expect(200);
      const again = await as(uma).get(`/games/${rematch.id}`).expect(200);
      expect(again.body.series).toEqual({ white: 0, black: 1 });
    });

    it('lets either player decline or withdraw an offer', async () => {
      const wes = await registerUser(app, 'wes_social');
      const xia = await registerUser(app, 'xia_social');
      const wesSocket = await connectAs(wes);
      const xiaSocket = await connectAs(xia);
      const gameId = await playAndResign(wes, xia);
      const offered = waitForEvent(xiaSocket, 'game:rematchOffered');
      wesSocket.emit('game:rematchOffer', { gameId });
      await offered;

      const declined = waitForEvent<{ gameId: string; by: string }>(
        wesSocket,
        'game:rematchDeclined',
      );
      xiaSocket.emit('game:rematchDecline', { gameId });

      expect(await declined).toEqual({ gameId, by: 'black' });
      const game = await as(wes).get(`/games/${gameId}`).expect(200);
      expect(game.body.rematchOfferedBy).toBeNull();
    });

    it('refuses a rematch of a game in play or aborted, or by someone who did not play', async () => {
      const yan = await registerUser(app, 'yan_social');
      const zed = await registerUser(app, 'zed_social');
      const ava = await registerUser(app, 'ava_social');
      const yanSocket = await connectAs(yan);
      const avaSocket = await connectAs(ava);
      const refusal = async (socket: Socket, gameId: string) => {
        const error = waitForEvent<{ message: string }>(socket, 'game:error');
        socket.emit('game:rematchOffer', { gameId });
        return (await error).message;
      };

      const aborted = await startGame(yan, zed);
      expect(await refusal(yanSocket, aborted)).toBe(
        'The game is still being played',
      );
      await as(zed).post(`/games/${aborted}/abort`).expect(200);
      expect(await refusal(yanSocket, aborted)).toBe(
        "An aborted game can't be rematched",
      );

      const finished = await playAndResign(yan, zed);
      expect(await refusal(avaSocket, finished)).toBe(
        'You are not playing in this game',
      );
    });
  });

  describe('game chat after the game', () => {
    it('stays open for the window, then closes', async () => {
      const cat = await registerUser(app, 'cat_social');
      const dan = await registerUser(app, 'dan_social');
      await makeFriends(app, cat, dan);
      const gameId = await playAndResign(cat, dan);
      const catSocket = await connectAs(cat);

      const delivered = waitForEvent<{ text: string }>(catSocket, 'game:chat');
      catSocket.emit('game:chat', { gameId, text: 'gg' });
      expect((await delivered).text).toBe('gg');

      process.env.GAME_CHAT_WINDOW_MS = '0';
      const refused = waitForEvent<{ message: string }>(
        catSocket,
        'game:error',
      );
      catSocket.emit('game:chat', { gameId, text: 'too late' });
      expect((await refused).message).toBe('Chat closed');
    });
  });
});
