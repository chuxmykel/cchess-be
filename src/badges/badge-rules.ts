import type { Color } from 'chess.js';

import type { ReviewScore } from '../games/entities/game-review.entity.js';
import type { GameBadgeKind } from './badge-kinds.js';
import {
  isEndgame,
  kingOf,
  mateKind,
  materialDown,
  other,
  winPercent,
} from './chess.js';
import { BADGES } from './thresholds.js';

/** A move of a finished game, as the server keeps it. */
export interface PlayedMove {
  color: Color;
  san: string;
  promotion: string | null;
  fenAfter: string;
  clockAfterMs: number;
}

export type GameResult = 'white' | 'black' | 'draw' | null;

/** A finished game, from one side. */
export interface GameForBadges {
  side: Color;
  result: GameResult;
  moves: PlayedMove[];
  /** Live games only: the starting time and increment. Null for daily. */
  clock: { initialMs: number; incrementMs: number } | null;
  bullet: boolean;
  /** Each player's rating going into the game, if rated or known. */
  ratings: Record<Color, number | null>;
}

/** What the review adds: each position's score (the start first), each
 * move's class and what it did (the app's classifier's word), and the
 * side's accuracy. */
export interface ReviewForBadges {
  scores: ReviewScore[];
  classes: { moveClass: string; facts: string[] }[];
  accuracy: number;
}

const SLIPS = ['mistake', 'miss', 'blunder'];
const BEST_FINDS = ['best', 'great', 'brilliant'];

function outcome(game: GameForBadges): { won: boolean; drew: boolean } {
  return {
    won: game.result === (game.side === 'w' ? 'white' : 'black'),
    drew: game.result === 'draw',
  };
}

/** The badges a game earned a side from the game alone: when it ends. */
export function gameBadges(game: GameForBadges): GameBadgeKind[] {
  const { side, moves } = game;
  const { won, drew } = outcome(game);
  const mine = moves.filter((move) => move.color === side);
  const last = moves.at(-1);
  const badges: GameBadgeKind[] = [];
  const earn = (kind: GameBadgeKind, earned: boolean) => {
    if (earned) badges.push(kind);
  };

  earn('miniature', won && mine.length <= BADGES.miniatureMoves);
  earn('marathon', won && mine.length >= BADGES.marathonMoves);
  earn(
    'fortress',
    drew && !!last && materialDown(last.fenAfter, side) >= BADGES.fortressDown,
  );
  earn(
    'underpromotion',
    won && mine.some((move) => ['n', 'r', 'b'].includes(move.promotion ?? '')),
  );
  const mate =
    last && last.color === side
      ? mateKind(last.san, last.fenAfter, side)
      : null;
  earn('smotheredMate', mate === 'smothered');
  earn('backRankMate', mate === 'backRank');
  earn('pawnMate', mate === 'pawn');
  earn(
    'kingsMarch',
    won &&
      mine.some((move) => {
        const king = kingOf(move.fenAfter, side);
        return !!king && (side === 'w' ? king[1] >= '5' : king[1] <= '4');
      }),
  );
  const lastOfMine = mine.at(-1);
  earn(
    'photoFinish',
    won &&
      !!game.clock &&
      !!lastOfMine &&
      lastOfMine.clockAfterMs < BADGES.photoFinishMs,
  );
  const mineRating = game.ratings[side];
  const theirs = game.ratings[other(side)];
  earn(
    'giantKiller',
    won &&
      mineRating !== null &&
      theirs !== null &&
      theirs - mineRating >= BADGES.giantKillerGap,
  );
  return badges;
}

/** How long each move took: the mover's time before it, its increment
 * added, less its time after; a side's first move took none. */
export function moveTimes(
  moves: PlayedMove[],
  clock: { initialMs: number; incrementMs: number },
): number[] {
  const left: Record<Color, number | null> = { w: null, b: null };
  return moves.map((move) => {
    const before = left[move.color];
    left[move.color] = move.clockAfterMs;
    return before === null
      ? 0
      : Math.max(0, before + clock.incrementMs - move.clockAfterMs);
  });
}

// How often the lead - a side winning - changed hands.
function leadChanges(scores: ReviewScore[]): number {
  let leader: Color | null = null;
  let changes = 0;
  for (const score of scores.slice(1)) {
    const white = winPercent(score, 'w');
    const now: Color | null =
      white >= BADGES.winningFrom
        ? 'w'
        : white < BADGES.losingBelow
          ? 'b'
          : null;
    if (now && now !== leader) {
      if (leader) changes += 1;
      leader = now;
    }
  }
  return changes;
}

/** The badges a game earned a side from its review: when it's saved. */
export function reviewBadges(
  game: GameForBadges,
  review: ReviewForBadges,
): GameBadgeKind[] {
  const { side, moves } = game;
  const { won, drew } = outcome(game);
  const { scores, classes, accuracy } = review;
  const chances = (index: number) => winPercent(scores[index], side);
  // After each move: scores[i + 1].
  const after = moves.map((_, i) => chances(i + 1));
  const mineIndexes = moves
    .map((move, i) => (move.color === side ? i : -1))
    .filter((i) => i >= 0);
  const mineClasses = mineIndexes.map((i) => classes[i]);
  const facts = mineClasses.flatMap((c) => c.facts);
  const badges: GameBadgeKind[] = [];
  const earn = (kind: GameBadgeKind, earned: boolean) => {
    if (earned) badges.push(kind);
  };

  // How it went.
  const lowest = Math.min(...scores.map((_, i) => chances(i)));
  const swindle = lowest < BADGES.swindleBelow && (won || drew);
  earn('swindle', swindle);
  earn('comeback', !swindle && lowest < BADGES.losingBelow && won);
  earn('heldDraw', !swindle && lowest < BADGES.losingBelow && drew);
  const lastBook = classes.findLastIndex((c) => c.moveClass === 'book');
  const afterBook = after.slice(lastBook + 1);
  earn(
    'neverInDoubt',
    won &&
      afterBook.length > 0 &&
      afterBook.every((c) => c >= BADGES.neverInDoubtFrom),
  );
  earn('rollercoaster', leadChanges(scores) >= BADGES.leadChanges);
  const endgameStart = moves.findIndex((move) => isEndgame(move.fenAfter));
  earn(
    'endgameGrind',
    won &&
      endgameStart !== -1 &&
      after[endgameStart] >= BADGES.losingBelow &&
      after[endgameStart] < BADGES.winningFrom,
  );

  // Brilliance and tactics.
  const brilliant = mineClasses.some((c) => c.moveClass === 'brilliant');
  earn('brilliancy', brilliant);
  earn(
    'sacrifice',
    won && (brilliant || facts.some((f) => f.startsWith('sacrifice'))),
  );
  earn('queenSacrifice', won && facts.includes('sacrifice:queen'));
  earn(
    'forkFrenzy',
    facts.filter((f) => f.split(':')[0] === 'fork').length >= BADGES.forks,
  );

  // Accuracy and preparation.
  const slipped = mineClasses.some((c) => SLIPS.includes(c.moveClass));
  earn(
    'clean',
    !slipped &&
      accuracy >= BADGES.cleanAccuracy &&
      mineIndexes.length >= BADGES.cleanMoves,
  );
  earn(
    'flawless',
    !slipped &&
      !mineClasses.some((c) => c.moveClass === 'inaccuracy') &&
      accuracy >= BADGES.flawlessAccuracy &&
      mineIndexes.length >= BADGES.flawlessMoves,
  );
  earn(
    'bookWorm',
    mineClasses.filter((c) => c.moveClass === 'book').length >=
      BADGES.bookMoves,
  );

  // The clock: a live game's.
  if (game.clock) {
    const times = moveTimes(moves, game.clock);
    let longest = -1;
    for (const i of mineIndexes) {
      if (longest === -1 || times[i] > times[longest]) longest = i;
    }
    earn(
      'deepThinker',
      longest !== -1 &&
        times[longest] >= BADGES.deepThinkMs &&
        BEST_FINDS.includes(classes[longest].moveClass),
    );
    earn(
      'lightningPrecision',
      game.bullet &&
        accuracy >= BADGES.lightningAccuracy &&
        mineIndexes.length >= BADGES.cleanMoves,
    );
  }
  return badges;
}

/** The rating lines a rated game crossed going up: each multiple of the
 * step above the rating going in, up to the rating after. */
export function ratingLinesCrossed(before: number, after: number): number[] {
  const lines: number[] = [];
  const step = BADGES.ratingStep;
  for (
    let line = Math.floor(before / step) * step + step;
    line <= after;
    line += step
  ) {
    lines.push(line);
  }
  return lines;
}

/** Whether finishing this many games is a milestone: 10, 100, 1000... */
export function isGamesMilestone(count: number): boolean {
  for (
    let milestone = BADGES.firstGamesMilestone;
    milestone <= count;
    milestone *= 10
  ) {
    if (milestone === count) return true;
  }
  return false;
}
