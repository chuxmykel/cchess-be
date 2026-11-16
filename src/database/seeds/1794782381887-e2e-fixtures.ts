import * as bcrypt from 'bcrypt';
import { Chess } from 'chess.js';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Seeder } from 'typeorm-extension';

import { BCRYPT_ROUNDS } from '../../auth/auth.service.js';
import { positionKey } from '../../chess/position-key.js';
import { type GameType, SECONDS_PER_DAY } from '../../chess/time-control.js';
import { Friendship } from '../../friends/entities/friendship.entity.js';
import {
  Game,
  type GameResult,
  type GameResultReason,
  STARTING_FEN,
} from '../../games/entities/game.entity.js';
import { Move } from '../../games/entities/move.entity.js';
import { Rating } from '../../users/entities/rating.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import { BOT_PASSWORD } from './1793893286008-bots.js';

/** The accounts the client's Maestro e2e flows sign in as (`../cchess`'s
 * `.maestro/common/sign-in.yaml`) and play against (its scripted opponent,
 * `--friend e2e_main`), each with BOT_PASSWORD. */
export const E2E_MAIN = 'e2e_main';
export const E2E_FRIEND = 'e2e_friend';

const DAY_MS = SECONDS_PER_DAY * 1000;

/** A game the flows find already there, as moves from the start. */
interface FixtureGame {
  mainPlays: 'w' | 'b';
  sans: string[];
  gameType: GameType;
  initialSeconds: number;
  incrementSeconds?: number;
  /** Its opponent's username, when not e2e_friend - one of the bots. */
  opponent?: string;
  /** Still being played (a daily game) - or else how it ended. */
  ended?: { result: GameResult; reason: GameResultReason; daysAgo: number };
  /** The ratings it changed, from white's side - finished rated games. */
  whiteRatingDiff?: number;
}

const FIXTURES: FixtureGame[] = [
  // The game reviewed: e2e_main's queen given away for a knight out of the
  // book (6...Qxg5?? 7.Bxg5) - a blunder for the review to stop at - then
  // resigned.
  {
    mainPlays: 'b',
    sans: [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bc4',
      'Nf6',
      'Ng5',
      'd5',
      'exd5',
      'Nxd5',
      'd4',
      'Qxg5',
      'Bxg5',
      'Be7',
      'Bxe7',
      'Ncxe7',
    ],
    gameType: 'blitz',
    initialSeconds: 300,
    ended: { result: 'white', reason: 'resignation', daysAgo: 0 },
    whiteRatingDiff: 8,
  },
  // Wins, losses and draws across the live categories over the last month,
  // for game history's filters and counts and the rating stats' chart.
  {
    mainPlays: 'w',
    sans: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    gameType: 'bullet',
    initialSeconds: 60,
    ended: { result: 'white', reason: 'checkmate', daysAgo: 3 },
    whiteRatingDiff: 9,
  },
  {
    mainPlays: 'w',
    sans: ['f3', 'e5', 'g4', 'Qh4#'],
    gameType: 'blitz',
    initialSeconds: 180,
    incrementSeconds: 2,
    ended: { result: 'black', reason: 'checkmate', daysAgo: 8 },
    whiteRatingDiff: -10,
  },
  {
    mainPlays: 'b',
    sans: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
    gameType: 'rapid',
    initialSeconds: 600,
    ended: { result: 'draw', reason: 'draw-agreement', daysAgo: 15 },
    whiteRatingDiff: 0,
  },
  {
    mainPlays: 'w',
    sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'],
    gameType: 'blitz',
    initialSeconds: 300,
    ended: { result: 'white', reason: 'timeout', daysAgo: 22 },
    whiteRatingDiff: 7,
  },
  // Aborted before the second move: listed, but never reviewed or rated.
  {
    mainPlays: 'w',
    sans: ['e4'],
    gameType: 'blitz',
    initialSeconds: 300,
    ended: { result: null, reason: 'abort', daysAgo: 1 },
  },
  // Daily games in progress: e2e_main to move against the friend (to play,
  // with move confirmation), and bot_2 to move (for conditional moves) -
  // told apart by their opponent, as the list's order changes once a move's
  // played.
  {
    mainPlays: 'w',
    sans: ['e4', 'e5'],
    gameType: 'daily',
    initialSeconds: 3 * SECONDS_PER_DAY,
  },
  {
    mainPlays: 'w',
    sans: ['d4'],
    opponent: 'bot_2',
    gameType: 'daily',
    initialSeconds: 3 * SECONDS_PER_DAY,
  },
];

/** Accounts and games for the client's end-to-end flows, on a database
 * made for them (cchess-infra's compose.e2e.yaml). Only with SEED_E2E=1:
 * nothing otherwise, so a dev `npm run seed:run` leaves the database
 * alone. Untracked (`track = false`), so it isn't marked as run when it
 * did nothing - it's safe to run again, doing nothing once e2e_main
 * exists. */
export class E2eFixtures1794782381887 implements Seeder {
  track = false;

  async run(dataSource: DataSource): Promise<string[]> {
    if (process.env.SEED_E2E !== '1') return [];
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to seed e2e fixtures in production');
    }
    const users = new UsersService(
      dataSource.getRepository(User),
      dataSource.getRepository(Rating),
    );
    if (await users.findByUsername(E2E_MAIN)) return [];

    const passwordHash = await bcrypt.hash(BOT_PASSWORD, BCRYPT_ROUNDS);
    const [main, friend] = await Promise.all(
      [E2E_MAIN, E2E_FRIEND].map((username) =>
        users.createRegisteredUser({
          username,
          email: `${username}@e2e.cchess.test`,
          passwordHash,
        }),
      ),
    );

    await dataSource.getRepository(Friendship).save({
      requesterId: main.id,
      addresseeId: friend.id,
      status: 'accepted',
      respondedAt: new Date(),
    });

    const now = Date.now();
    for (const fixture of FIXTURES) {
      const opponent = fixture.opponent
        ? await users.findByUsername(fixture.opponent)
        : friend;
      if (!opponent) {
        throw new Error(`Seed the bots first: no ${fixture.opponent}`);
      }
      const [white, black] =
        fixture.mainPlays === 'w' ? [main, opponent] : [opponent, main];
      await saveGame(dataSource, fixture, white.id, black.id, now);
    }
    return [E2E_MAIN, E2E_FRIEND];
  }
}

/** A fixture game and its moves, played through chess.js so an illegal
 * line fails the seed rather than storing a game the app can't replay. */
async function saveGame(
  dataSource: DataSource,
  fixture: FixtureGame,
  whiteId: string,
  blackId: string,
  now: number,
): Promise<void> {
  const chess = new Chess();
  const clockMs = fixture.initialSeconds * 1000;
  const endedAt = fixture.ended
    ? new Date(now - fixture.ended.daysAgo * DAY_MS)
    : null;
  // A finished game is dated by its end; one in progress last moved an
  // hour ago, well inside its days a move.
  const lastMoveAt = endedAt ?? new Date(now - 60 * 60 * 1000);
  const gameId = randomUUID();

  const moves = fixture.sans.map((san, index) => {
    const fenBefore = chess.fen();
    const move = chess.move(san);
    return dataSource.getRepository(Move).create({
      id: randomUUID(),
      gameId,
      ply: index + 1,
      from: move.from,
      to: move.to,
      piece: move.piece,
      color: move.color,
      san: move.san,
      captured: move.captured ?? null,
      promotion: move.promotion ?? null,
      fenAfter: chess.fen(),
      positionKey: positionKey(fenBefore),
      clockAfterMs: clockMs,
      createdAt: lastMoveAt,
    });
  });

  const diff = fixture.whiteRatingDiff;
  const rated = diff !== undefined;
  await dataSource.getRepository(Game).save({
    id: gameId,
    whiteId,
    blackId,
    initialSeconds: fixture.initialSeconds,
    incrementSeconds: fixture.incrementSeconds ?? 0,
    gameType: fixture.gameType,
    rated,
    whiteRatingAtStart: rated ? 1500 : null,
    blackRatingAtStart: rated ? 1500 : null,
    whiteRatingDiff: rated ? diff : null,
    blackRatingDiff: rated ? -diff : null,
    status: fixture.ended
      ? fixture.ended.reason === 'abort'
        ? 'aborted'
        : 'completed'
      : 'active',
    result: fixture.ended?.result ?? null,
    resultReason: fixture.ended?.reason ?? null,
    fen: fixture.sans.length ? chess.fen() : STARTING_FEN,
    pgn: chess.pgn(),
    whiteTimeRemainingMs: clockMs,
    blackTimeRemainingMs: clockMs,
    turn: chess.turn(),
    lastMoveAt,
    createdAt: new Date(lastMoveAt.getTime() - DAY_MS / 24),
    endedAt,
  });
  await dataSource.getRepository(Move).save(moves);
}
