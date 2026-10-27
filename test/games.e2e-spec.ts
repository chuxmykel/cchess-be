import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rateGame } from '../src/games/glicko2.js';
import {
  STARTING_DEVIATION,
  STARTING_RATING,
  STARTING_VOLATILITY,
} from '../src/users/entities/rating.entity.js';
import { createTestApp, registerUser } from './utils/app.js';

const NEW_PLAYER = {
  rating: STARTING_RATING,
  deviation: STARTING_DEVIATION,
  volatility: STARTING_VOLATILITY,
};
const NEW_PLAYER_WIN = Math.round(
  rateGame(NEW_PLAYER, NEW_PLAYER, 1, 1).rating - STARTING_RATING,
);

describe('Games via challenges (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('challenges a user, accepts, plays moves, and resigns', async () => {
    const ivan = await registerUser(app, 'ivan_games');
    const judy = await registerUser(app, 'judy_games');

    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({
        opponentUsername: judy.username,
        minutes: 5,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    expect(challenge.body.status).toBe('pending');

    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(201);
    const gameId = accepted.body.id;
    expect(accepted.body.white.username).toBe(ivan.username);
    expect(accepted.body.black.username).toBe(judy.username);
    expect(accepted.body.white.rating).toBe(STARTING_RATING);
    expect(accepted.body.black.rating).toBe(STARTING_RATING);
    expect(accepted.body.black.provisional).toBe(true);

    await request(app.getHttpServer())
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({ from: 'e2', to: 'e4' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ from: 'e7', to: 'e5' })
      .expect(201);

    // Judy can't move again - it's Ivan's turn.
    await request(app.getHttpServer())
      .post(`/games/${gameId}/moves`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .send({ from: 'd7', to: 'd5' })
      .expect(409);

    const resigned = await request(app.getHttpServer())
      .post(`/games/${gameId}/resign`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(resigned.body.result).toBe('black');
    expect(resigned.body.resultReason).toBe('resignation');

    const history = await request(app.getHttpServer())
      .get('/games')
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].result).toBe('win');
    expect(history.body[0].opponentRating).toBe(STARTING_RATING);
    expect(history.body[0].ratingDiff).toBe(NEW_PLAYER_WIN);

    const loserHistory = await request(app.getHttpServer())
      .get('/games')
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(loserHistory.body[0].result).toBe('loss');
    expect(loserHistory.body[0].ratingDiff).toBe(-NEW_PLAYER_WIN);

    const pgn = await request(app.getHttpServer())
      .get(`/games/${gameId}/pgn`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .expect(200);
    expect(pgn.text).toContain(
      '[White "ivan_games"]'.replace('ivan_games', ivan.username),
    );
    expect(pgn.text).toContain('0-1');
  });

  it('matches two seeking players and lets them abort early', async () => {
    const kim = await registerUser(app, 'kim_games');
    const liam = await registerUser(app, 'liam_games');

    await request(app.getHttpServer())
      .post('/matchmaking/seek')
      .set('Authorization', `Bearer ${kim.accessToken}`)
      .send({ minutes: 3, incrementSeconds: 0 })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('queued'));

    const matched = await request(app.getHttpServer())
      .post('/matchmaking/seek')
      .set('Authorization', `Bearer ${liam.accessToken}`)
      .send({ minutes: 3, incrementSeconds: 0 })
      .expect(201);
    expect(matched.body.status).toBe('matched');
    const gameId = matched.body.game.id;
    expect(matched.body.game.gameType).toBe('blitz');

    const otherPlayerToken =
      matched.body.game.white.username === kim.username
        ? kim.accessToken
        : liam.accessToken;

    const aborted = await request(app.getHttpServer())
      .post(`/games/${gameId}/abort`)
      .set('Authorization', `Bearer ${otherPlayerToken}`)
      .expect(200);
    expect(aborted.body.status).toBe('aborted');
  });

  describe('seek options', () => {
    function seek(accessToken: string, body: object) {
      return request(app.getHttpServer())
        .post('/matchmaking/seek')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
    }

    const fiveMinutes = { minutes: 5, incrementSeconds: 0 };

    it('plays casual seeks as unrated games', async () => {
      const mia = await registerUser(app, 'mia_seeks');
      const noah = await registerUser(app, 'noah_seeks');

      await seek(mia.accessToken, { ...fiveMinutes, rated: false }).expect(201);
      const matched = await seek(noah.accessToken, {
        ...fiveMinutes,
        rated: false,
      }).expect(201);

      expect(matched.body.status).toBe('matched');
      expect(matched.body.game.rated).toBe(false);
    });

    it('keeps rated and casual seeks apart', async () => {
      const olga = await registerUser(app, 'olga_seeks');
      const paul = await registerUser(app, 'paul_seeks');

      await seek(olga.accessToken, { ...fiveMinutes, rated: true });
      const second = await seek(paul.accessToken, {
        ...fiveMinutes,
        rated: false,
      }).expect(201);

      expect(second.body.status).toBe('queued');
    });

    it("pairs only when each rating is in the other's range", async () => {
      const quinn = await registerUser(app, 'quinn_seeks');
      const rosa = await registerUser(app, 'rosa_seeks');

      await seek(quinn.accessToken, {
        ...fiveMinutes,
        ratingRange: { below: 0, above: 0 },
      });
      const matched = await seek(rosa.accessToken, {
        ...fiveMinutes,
        ratingRange: { below: 100, above: 100 },
      }).expect(201);

      expect(matched.body.status).toBe('matched');
      expect(matched.body.game.rated).toBe(true);
      await request(app.getHttpServer())
        .get('/matchmaking/status')
        .set('Authorization', `Bearer ${quinn.accessToken}`)
        .expect(200)
        .expect(({ body }) => expect(body.seeking).toBe(false));
    });

    it('accepts a rating range with an open side', async () => {
      const tara = await registerUser(app, 'tara_seeks');

      await seek(tara.accessToken, {
        ...fiveMinutes,
        ratingRange: { below: null, above: 200 },
      })
        .expect(201)
        .expect(({ body }) => expect(body.status).toBe('queued'));
      await request(app.getHttpServer())
        .get('/matchmaking/status')
        .set('Authorization', `Bearer ${tara.accessToken}`)
        .expect(200)
        .expect(({ body }) =>
          expect(body.ratingRange).toEqual({ below: null, above: 200 }),
        );
    });

    it('rejects a rating range outside the allowed deltas', async () => {
      const sam = await registerUser(app, 'sam_seeks');

      await seek(sam.accessToken, {
        ...fiveMinutes,
        ratingRange: { below: -50, above: 100 },
      }).expect(400);
    });
  });

  it('bookmarks a game and removes the bookmark', async () => {
    const yara = await registerUser(app, 'yara_games');
    const zane = await registerUser(app, 'zane_games');
    const challenge = await request(app.getHttpServer())
      .post('/challenges')
      .set('Authorization', `Bearer ${yara.accessToken}`)
      .send({
        opponentUsername: zane.username,
        minutes: 5,
        incrementSeconds: 0,
      })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', `Bearer ${zane.accessToken}`)
      .expect(201);
    const bookmarkUrl = `/games/${accepted.body.id}/bookmark`;
    const asYara = (call: request.Test) =>
      call.set('Authorization', `Bearer ${yara.accessToken}`);

    await asYara(request(app.getHttpServer()).get(bookmarkUrl))
      .expect(200)
      .expect({ bookmarked: false });
    await asYara(request(app.getHttpServer()).put(bookmarkUrl))
      .expect(200)
      .expect({ bookmarked: true });
    await asYara(request(app.getHttpServer()).put(bookmarkUrl)).expect(200);
    await asYara(request(app.getHttpServer()).get(bookmarkUrl)).expect({
      bookmarked: true,
    });
    await request(app.getHttpServer())
      .get(bookmarkUrl)
      .set('Authorization', `Bearer ${zane.accessToken}`)
      .expect({ bookmarked: false });
    await asYara(request(app.getHttpServer()).delete(bookmarkUrl))
      .expect(200)
      .expect({ bookmarked: false });
    await asYara(request(app.getHttpServer()).get(bookmarkUrl)).expect({
      bookmarked: false,
    });
  });

  it('refuses to bookmark a game that does not exist', async () => {
    const abby = await registerUser(app, 'abby_games');

    await request(app.getHttpServer())
      .put('/games/00000000-0000-4000-8000-000000000000/bookmark')
      .set('Authorization', `Bearer ${abby.accessToken}`)
      .expect(404);
  });
});
