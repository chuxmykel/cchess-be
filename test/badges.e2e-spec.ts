import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BadgesService } from '../src/badges/badges.service.js';
import { Game } from '../src/games/entities/game.entity.js';
import { Rating } from '../src/users/entities/rating.entity.js';
import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

const evalAt = (cp: number) => ({
  score: { kind: 'cp', cp },
  pv: ['e2e4'],
  second: null,
  depth: 14,
});

describe('Badges (e2e)', () => {
  let app: INestApplication;
  let ivan: RegisteredUser;
  let judy: RegisteredUser;

  beforeEach(async () => {
    app = await createTestApp();
    ivan = await registerUser(app, 'ivan_badges');
    judy = await registerUser(app, 'judy_badges');
    await makeFriends(app, ivan, judy);
  });

  afterEach(async () => {
    await app.close();
  });

  // 1. e4 e5, then ivan (white) resigns: judy wins in one move.
  async function playGame(): Promise<string> {
    const server = app.getHttpServer();
    const as = (user: RegisteredUser) => `Bearer ${user.accessToken}`;
    const challenge = await request(server)
      .post('/challenges')
      .set('Authorization', as(ivan))
      .send({
        opponentUsername: judy.username,
        initialSeconds: 300,
        incrementSeconds: 0,
        color: 'white',
      })
      .expect(201);
    const { body } = await request(server)
      .post(`/challenges/${challenge.body.id}/accept`)
      .set('Authorization', as(judy))
      .expect(201);
    for (const [user, from, to] of [
      [ivan, 'e2', 'e4'],
      [judy, 'e7', 'e5'],
    ] as const) {
      await request(server)
        .post(`/games/${body.id}/moves`)
        .set('Authorization', as(user))
        .send({ from, to })
        .expect(201);
    }
    await request(server)
      .post(`/games/${body.id}/resign`)
      .set('Authorization', as(ivan))
      .expect(200);
    return body.id;
  }

  const badgesOf = async (user: RegisteredUser, viewer = user) =>
    (
      await request(app.getHttpServer())
        .get(`/users/${user.username}/badges`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(200)
    ).body as {
      id: string;
      kind: string;
      game: { gameId: string; result: string; opponentUsername: string } | null;
      value: number | null;
      category: string | null;
    }[];

  // The game-ended badges are awarded as the event is handled.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  it('awards a game its badges when it ends, with the game', async () => {
    const gameId = await playGame();
    await settle();

    const judys = await badgesOf(judy);
    expect(judys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'miniature',
          game: expect.objectContaining({
            gameId,
            result: 'win',
            opponentUsername: ivan.username,
          }),
        }),
      ]),
    );
    // Challenges are rated, and her first win took her past 1600 - but a
    // first rating is provisional, so it reaches no line yet.
    expect(judys).toHaveLength(1);
    expect(await badgesOf(ivan)).toEqual([]);
  });

  it("awards a review's badges from the app's classes, once", async () => {
    const gameId = await playGame();
    await settle();
    const save = (depth: number) =>
      request(app.getHttpServer())
        .put(`/games/${gameId}/review`)
        .set('Authorization', `Bearer ${ivan.accessToken}`)
        .send({
          engine: 'stockfish',
          depth,
          whiteAccuracy: 90,
          blackAccuracy: 90,
          evals: [evalAt(20), evalAt(30), evalAt(25)],
          moveClasses: [
            { moveClass: 'brilliant', facts: ['sacrifice:queen'] },
            { moveClass: 'book', facts: [] },
          ],
        });

    const saved = await save(14).expect(200);
    expect(saved.body.badges).toEqual({
      w: ['brilliancy'],
      b: ['miniature'],
    });
    // A deeper review again: nothing twice.
    await save(16).expect(200);
    const ivans = await badgesOf(ivan);
    expect(ivans.map((b) => b.kind)).toEqual(['brilliancy']);
    expect(ivans[0].game?.result).toBe('loss');

    const fetched = await request(app.getHttpServer())
      .get(`/games/${gameId}/review`)
      .set('Authorization', `Bearer ${judy.accessToken}`)
      .expect(200);
    expect(fetched.body.badges).toEqual({
      w: ['brilliancy'],
      b: ['miniature'],
    });
  });

  it("refuses move classes that aren't one a move", async () => {
    const gameId = await playGame();
    await request(app.getHttpServer())
      .put(`/games/${gameId}/review`)
      .set('Authorization', `Bearer ${ivan.accessToken}`)
      .send({
        engine: 'stockfish',
        depth: 14,
        whiteAccuracy: 90,
        blackAccuracy: 90,
        evals: [evalAt(20), evalAt(30), evalAt(25)],
        moveClasses: [{ moveClass: 'best', facts: [] }],
      })
      .expect(400);
  });

  it("shows anyone a player's badges", async () => {
    await playGame();
    await settle();

    expect((await badgesOf(judy, ivan)).map((b) => b.kind)).toEqual([
      'miniature',
    ]);
  });

  it('awards milestones: the 10th game, and each rating line crossed once the rating is certain', async () => {
    const games = app.get(DataSource).getRepository(Game);
    const finished = (minute: number) =>
      ({
        whiteId: judy.userId,
        blackId: ivan.userId,
        initialSeconds: 180,
        incrementSeconds: 0,
        gameType: 'blitz',
        rated: false,
        status: 'completed',
        result: 'draw',
        resultReason: 'draw-agreement',
        fen: 'start',
        pgn: '',
        whiteTimeRemainingMs: 0,
        blackTimeRemainingMs: 0,
        turn: 'w',
        endedAt: new Date(Date.UTC(2026, 9, 1, 0, minute)),
      }) as Partial<Game>;
    await games.save(Array.from({ length: 9 }, (_, i) => finished(i)));
    const ratings = app.get(DataSource).getRepository(Rating);
    const service = app.get(BadgesService);
    const award = async (before: number, diff: number, minute: number) => {
      const game = await games.save({
        ...finished(minute),
        rated: true,
        result: 'white',
        whiteRatingAtStart: before,
        whiteRatingDiff: diff,
      } as Partial<Game>);
      await service.awardForGame(game.id as string);
      return game.id as string;
    };
    const ratingLines = async () =>
      (await badgesOf(judy))
        .filter((b) => b.kind === 'ratingReached')
        .map((b) => [b.category, b.value, b.game?.gameId]);

    // The 10th, crossing 1600 and 1700 - while her rating's provisional:
    // the games milestone, but no rating line.
    await ratings.upsert(
      { userId: judy.userId, category: 'blitz', rating: 1710, deviation: 200 },
      ['userId', 'category'],
    );
    const tenth = await award(1590, 120, 10);
    expect(
      (await badgesOf(judy))
        .filter((b) => b.value !== null)
        .map((b) => [b.kind, b.value, b.game?.gameId]),
    ).toEqual([['gamesPlayed', 10, tenth]]);
    expect(await ratingLines()).toEqual([]);

    // Certain now: crossing 1700 again counts, once.
    await ratings.update(
      { userId: judy.userId, category: 'blitz' },
      { deviation: 60 },
    );
    const certain = await award(1690, 20, 20);
    expect(await ratingLines()).toEqual([['blitz', 1700, certain]]);
    await award(1690, 30, 30);
    expect(await ratingLines()).toHaveLength(1);
  });
});
