import { BadRequestException } from '@nestjs/common';

// A review's digests: each side's review boiled down, worked out on the
// device with the review and kept with it - for a player's patterns across
// games. Their shape is checked here, since the server only
// keeps them: version 1, as the app's domain/review/digest.ts writes them.
// Badges aren't in them: the server awards those itself (src/badges).
export type SideDigest = {
  v: 1;
  accuracy: number;
  result: 'win' | 'loss' | 'draw' | null;
  opening: string | null;
  moves: number;
  missedTactics: number;
  slips: {
    ply: number;
    mark: '?!' | '?' | '??';
    facts: string[];
    phase: 'opening' | 'middlegame' | 'endgame';
    clockShare: number | null;
  }[];
  accuracyByClock: { plenty: number; short: number } | null;
  /** Average accuracy in each phase it played in - null in one it didn't. */
  accuracyByPhase: Record<Phase, number | null>;
  /** How many of its moves earned each mark. */
  marks: Record<Mark, number>;
  /** Its highest and lowest winning chances after the book, 0 to 100. */
  chances: { high: number; low: number };
};

type Phase = 'opening' | 'middlegame' | 'endgame';
type Mark = '!!' | '!' | '?!' | '?' | '??';
const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
const MARKS: Mark[] = ['!!', '!', '?!', '?', '??'];

export type ReviewDigests = { w: SideDigest; b: SideDigest };

const MAX_SLIPS = 300;
const MAX_FACTS = 20;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, max: number) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
const isPercent = (value: unknown) =>
  typeof value === 'number' && value >= 0 && value <= 100;

function isSlip(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isInt(value.ply, 2000) &&
    ['?!', '?', '??'].includes(value.mark as string) &&
    Array.isArray(value.facts) &&
    value.facts.length <= MAX_FACTS &&
    value.facts.every((f) => typeof f === 'string' && f.length <= 32) &&
    ['opening', 'middlegame', 'endgame'].includes(value.phase as string) &&
    (value.clockShare === null ||
      (typeof value.clockShare === 'number' &&
        value.clockShare >= 0 &&
        value.clockShare <= 10))
  );
}

function isSideDigest(value: unknown): value is SideDigest {
  if (!isObject(value)) return false;
  const clock = value.accuracyByClock;
  return (
    value.v === 1 &&
    isPercent(value.accuracy) &&
    [null, 'win', 'loss', 'draw'].includes(value.result as string | null) &&
    (value.opening === null ||
      (typeof value.opening === 'string' && value.opening.length <= 200)) &&
    isInt(value.moves, 1000) &&
    isInt(value.missedTactics, 1000) &&
    Array.isArray(value.slips) &&
    value.slips.length <= MAX_SLIPS &&
    value.slips.every(isSlip) &&
    (clock === null ||
      (isObject(clock) && isPercent(clock.plenty) && isPercent(clock.short))) &&
    isObject(value.accuracyByPhase) &&
    PHASES.every((phase) => {
      const accuracy = (value.accuracyByPhase as Record<string, unknown>)[
        phase
      ];
      return accuracy === null || isPercent(accuracy);
    }) &&
    isObject(value.marks) &&
    MARKS.every((mark) =>
      isInt((value.marks as Record<string, unknown>)[mark], 1000),
    ) &&
    isObject(value.chances) &&
    isPercent(value.chances.high) &&
    isPercent(value.chances.low)
  );
}

/** The digests as given, or a 400 when they aren't a review's. */
export function parseReviewDigests(value: unknown): ReviewDigests {
  if (isObject(value) && isSideDigest(value.w) && isSideDigest(value.b)) {
    return { w: value.w, b: value.b };
  }
  throw new BadRequestException("Those aren't a review's digests");
}
