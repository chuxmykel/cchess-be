import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Puzzle } from '../src/puzzles/entities/puzzle.entity.js';
import {
  createTestApp,
  makeFriends,
  type RegisteredUser,
  registerUser,
} from './utils/app.js';

// Lichess's puzzle 00sHx: black plays e8d7, and white mates in two.
const MATE_IN_TWO = {
  fen: 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17',
  moves: 'e8d7 a2e6 d7d8 f7f8',
  ratingDeviation: 80,
  popularity: 90,
  nbPlays: 1000,
};

describe('Puzzles (e2e)', () => {
  let app: INestApplication;
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

  async function pool(
    puzzles: { id: string; rating: number; themes: string[] }[],
  ) {
    await app
      .get(DataSource)
      .getRepository(Puzzle)
      .save(puzzles.map((p) => ({ ...MATE_IN_TWO, ...p })));
  }

  beforeEach(async () => {
    app = await createTestApp();
    ana = await registerUser(app, 'ana_pz');
    bob = await registerUser(app, 'bob_pz');
  });

  afterEach(async () => {
    await app.close();
  });

  describe('the pool', () => {
    it('serves a puzzle near your rating, of the theme asked for', async () => {
      await pool([
        { id: 'near1', rating: 1520, themes: ['mate', 'mateIn2'] },
        { id: 'far01', rating: 2600, themes: ['mate', 'mateIn2'] },
        { id: 'fork1', rating: 1480, themes: ['fork'] },
      ]);

      const fork = await as(ana).get('/puzzles/next?theme=fork').expect(200);
      expect(fork.body).toMatchObject({
        id: 'fork1',
        moves: ['e8d7', 'a2e6', 'd7d8', 'f7f8'],
      });
      const mate = await as(ana).get('/puzzles/next?theme=mateIn2').expect(200);
      expect(mate.body.id).toBe('near1');
    });

    it('moves your rating with each try, and serves a puzzle tried no more', async () => {
      await pool([{ id: 'only1', rating: 1500, themes: ['mate'] }]);
      expect(
        (await as(ana).get('/puzzles/rating').expect(200)).body,
      ).toMatchObject({ rating: 1500, attempts: 0 });

      const solved = await as(ana)
        .post('/puzzles/only1/attempt')
        .send({ solved: true })
        .expect(200);
      expect(solved.body.ratingBefore).toBe(1500);
      expect(solved.body.ratingAfter).toBeGreaterThan(1500);
      expect((await as(ana).get('/puzzles/rating')).body.attempts).toBe(1);

      await as(ana).get('/puzzles/next').expect(404);
      // Another player still gets it.
      expect((await as(bob).get('/puzzles/next').expect(200)).body.id).toBe(
        'only1',
      );
    });

    it("shows your puzzle rating on your profile, once you've tried one", async () => {
      await pool([{ id: 'only1', rating: 1500, themes: ['mate'] }]);
      await as(ana).get('/puzzles/rating').expect(200);
      const before = await as(bob).get(`/users/${ana.username}`).expect(200);
      expect(before.body.puzzleRating).toBeNull();

      const { body } = await as(ana)
        .post('/puzzles/only1/attempt')
        .send({ solved: true })
        .expect(200);

      const after = await as(bob).get(`/users/${ana.username}`).expect(200);
      expect(after.body.puzzleRating).toEqual({
        rating: Math.round(body.ratingAfter),
        attempts: 1,
        provisional: true,
      });
    });

    it("charts anyone's puzzle rating and tries over a period", async () => {
      await pool([
        { id: 'easy1', rating: 1400, themes: ['fork'] },
        { id: 'hard1', rating: 1700, themes: ['fork', 'pin'] },
      ]);
      await as(bob).get(`/users/${ana.username}/puzzles/stats`).expect(404);

      await as(ana)
        .post('/puzzles/easy1/attempt')
        .send({ solved: false })
        .expect(200);
      const last = await as(ana)
        .post('/puzzles/hard1/attempt')
        .send({ solved: true })
        .expect(200);

      const { body } = await as(bob)
        .get(`/users/${ana.username}/puzzles/stats?period=1w`)
        .expect(200);
      expect(body).toMatchObject({
        period: '1w',
        rating: {
          rating: Math.round(last.body.ratingAfter),
          attempts: 2,
          provisional: true,
        },
        attempts: 2,
        solved: 1,
        missed: 1,
        bestSolve: { puzzleId: 'hard1', rating: 1700 },
        longestSolvedStreak: 1,
        longestMissedStreak: 1,
        ratingChange: Math.round(last.body.ratingAfter) - 1500,
      });
      // The rating going in, then the day's close.
      expect(body.history.map((p: { rating: number }) => p.rating)).toEqual([
        1500,
        Math.round(last.body.ratingAfter),
      ]);
      expect(body.themes).toEqual([
        { theme: 'fork', attempts: 2, solved: 1 },
        { theme: 'pin', attempts: 1, solved: 1 },
      ]);
      await as(bob)
        .get(`/users/${ana.username}/puzzles/stats?period=2w`)
        .expect(400);
    });

    it('has no attempt at a puzzle that is not there', async () => {
      await as(ana)
        .post('/puzzles/nope/attempt')
        .send({ solved: true })
        .expect(404);
    });
  });

  describe('your own puzzles', () => {
    // A game between them, two moves in, then resigned.
    async function playGame(): Promise<string> {
      await makeFriends(app, ana, bob);
      const challenge = await as(ana)
        .post('/challenges')
        .send({
          opponentUsername: bob.username,
          initialSeconds: 300,
          incrementSeconds: 0,
          color: 'white',
        })
        .expect(201);
      const accepted = await as(bob)
        .post(`/challenges/${challenge.body.id}/accept`)
        .expect(201);
      const gameId: string = accepted.body.id;
      await as(ana)
        .post(`/games/${gameId}/moves`)
        .send({ from: 'e2', to: 'e4' });
      await as(bob)
        .post(`/games/${gameId}/moves`)
        .send({ from: 'e7', to: 'e5' });
      await as(ana).post(`/games/${gameId}/resign`).expect(200);
      return gameId;
    }
    const START_AFTER_E4_E5 =
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const missed = (ply: number) => ({
      ply,
      fen: START_AFTER_E4_E5,
      solution: ['g1f3', 'b8c6', 'f1b5'],
      themes: ['advantage'],
    });

    it('keeps the tactics you missed, once each, due at once', async () => {
      const gameId = await playGame();
      const added = await as(ana)
        .post('/puzzles/mine')
        .send({ gameId, puzzles: [missed(3), missed(5)] })
        .expect(201);
      expect(added.body.added).toBe(2);
      // Sent again: nothing new.
      await as(ana)
        .post('/puzzles/mine')
        .send({ gameId, puzzles: [missed(3)] })
        .expect(201);

      const mine = await as(ana).get('/puzzles/mine').expect(200);
      expect(mine.body).toMatchObject({
        dueCount: 2,
        learning: 0,
        mastered: 0,
      });
      expect(mine.body.due[0]).toMatchObject({
        fen: START_AFTER_E4_E5,
        solution: ['g1f3', 'b8c6', 'f1b5'],
        step: 0,
      });
    });

    it('takes them only from your own games, with a line legal from the position', async () => {
      const gameId = await playGame();
      const carol = await registerUser(app, 'carol_pz');
      await as(carol)
        .post('/puzzles/mine')
        .send({ gameId, puzzles: [missed(3)] })
        .expect(403);
      await as(ana)
        .post('/puzzles/mine')
        .send({ gameId, puzzles: [{ ...missed(3), solution: ['e1e8'] }] })
        .expect(400);
    });

    it('moves one along when found, and back when missed', async () => {
      const gameId = await playGame();
      await as(ana)
        .post('/puzzles/mine')
        .send({ gameId, puzzles: [missed(3)] })
        .expect(201);
      const [puzzle] = (await as(ana).get('/puzzles/mine')).body.due;

      const found = await as(ana)
        .post(`/puzzles/mine/${puzzle.id}/attempt`)
        .send({ solved: true })
        .expect(200);
      expect(found.body.step).toBe(1);
      expect((await as(ana).get('/puzzles/mine')).body).toMatchObject({
        dueCount: 0,
        learning: 1,
      });

      const lost = await as(ana)
        .post(`/puzzles/mine/${puzzle.id}/attempt`)
        .send({ solved: false })
        .expect(200);
      expect(lost.body.step).toBe(0);
      // Nobody else can touch it.
      await as(bob)
        .post(`/puzzles/mine/${puzzle.id}/attempt`)
        .send({ solved: true })
        .expect(404);
    });
  });
});
