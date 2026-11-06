/**
 * Conditional moves, as chess.com has them for daily games: "if they play
 * this, I reply that" - each branch the opponent's move, the player's
 * reply to it, and what follows. Moves are UCI ("e2e4", "e7e8q").
 */
export interface ConditionalBranch {
  opponent: string;
  reply: string;
  next: ConditionalBranch[];
}

export type ConditionalTree = ConditionalBranch[];

/** The most lines a player may keep for a game, and moves a line. */
export const MAX_CONDITIONAL_LINES = 10;
export const MAX_CONDITIONAL_LINE_MOVES = 20;

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export class ConditionalMovesError extends Error {}

/** A line as far as its last reply: one ending on the opponent's move
 * says nothing about what to play. */
export function trimLine(line: string[]): string[] {
  return line.slice(0, line.length - (line.length % 2));
}

/** `tree` with `lines` added - each the opponent's move, the reply,
 * theirs, the reply... from the same position. Throws on two different
 * replies to one move: only one can be played. */
export function mergeLines(
  tree: ConditionalTree,
  lines: string[][],
): ConditionalTree {
  const merged = structuredClone(tree);
  for (const raw of lines) {
    const line = trimLine(raw);
    if (line.some((move) => typeof move !== 'string' || !UCI.test(move))) {
      throw new ConditionalMovesError('Moves must be in UCI, like e2e4');
    }
    let branches = merged;
    for (let i = 0; i < line.length; i += 2) {
      const [opponent, reply] = [line[i], line[i + 1]];
      let branch = branches.find((b) => b.opponent === opponent);
      if (!branch) {
        branch = { opponent, reply, next: [] };
        branches.push(branch);
      } else if (branch.reply !== reply) {
        throw new ConditionalMovesError(`Two different replies to ${opponent}`);
      }
      branches = branch.next;
    }
  }
  return merged;
}

/** Every line in the tree, root to leaf. */
export function linesOf(tree: ConditionalTree): string[][] {
  return tree.flatMap((branch) => {
    const head = [branch.opponent, branch.reply];
    return branch.next.length === 0
      ? [head]
      : linesOf(branch.next).map((rest) => [...head, ...rest]);
  });
}

/** The branch for the opponent's move just played, if there's one. */
export function branchFor(
  tree: ConditionalTree,
  opponentMove: string,
): ConditionalBranch | undefined {
  return tree.find((branch) => branch.opponent === opponentMove);
}

export function toUci(move: {
  from: string;
  to: string;
  promotion?: string | null;
}): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function fromUci(uci: string): {
  from: string;
  to: string;
  promotion?: string;
} {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  };
}
