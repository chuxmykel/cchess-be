import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { PieceSymbol, Square } from 'chess.js';
import { Repository } from 'typeorm';

import { ServerChessEngine } from '../chess/chess-engine.js';
import {
  ConditionalMovesError,
  fromUci,
  linesOf,
  MAX_CONDITIONAL_LINE_MOVES,
  MAX_CONDITIONAL_LINES,
  mergeLines,
  trimLine,
} from './conditional-moves.js';
import { isDailyGame } from './daily.js';
import { ConditionalMoveSet } from './entities/conditional-move-set.entity.js';
import { GamesService } from './games.service.js';

export interface ConditionalLines {
  /** The game's move count the lines start from; null with none. */
  basePly: number | null;
  /** Each the opponent's move, your reply, theirs... in UCI. */
  lines: string[][];
}

/**
 * Saving and reading a player's conditional moves in a daily game; playing
 * them is GamesService's, as the opponent's move lands. Saved only while
 * the opponent is to move, from the position as it stands: a set saved
 * against a position that has since moved on is dropped when it's next
 * looked at, as it would be by a move it didn't foresee.
 */
@Injectable()
export class ConditionalMovesService {
  constructor(
    @InjectRepository(ConditionalMoveSet)
    private readonly sets: Repository<ConditionalMoveSet>,
    private readonly gamesService: GamesService,
  ) {}

  async get(userId: string, gameId: string): Promise<ConditionalLines> {
    const game = await this.gamesService.getGameWithMoves(gameId);
    this.gamesService.colorOf(game, userId);
    const set = await this.sets.findOneBy({ userId, gameId });
    if (!set || set.basePly !== game.moves.length) {
      return { basePly: null, lines: [] };
    }
    return { basePly: set.basePly, lines: linesOf(set.tree) };
  }

  /** Adds `lines`, from the game's position after `basePly` moves, to any
   * already saved from there - or, with `replace`, saves them in their
   * place. */
  async add(
    userId: string,
    gameId: string,
    basePly: number,
    lines: string[][],
    { replace = false }: { replace?: boolean } = {},
  ): Promise<ConditionalLines> {
    const game = await this.gamesService.getGameWithMoves(gameId);
    const color = this.gamesService.colorOf(game, userId);
    if (!isDailyGame(game)) {
      throw new BadRequestException('Only daily games have conditional moves');
    }
    if (game.status !== 'active') {
      throw new ConflictException('Game is not active');
    }
    if (game.turn === color) {
      throw new ConflictException("It's your move - play it instead");
    }
    if (basePly !== game.moves.length) {
      throw new ConflictException('The game has moved on since');
    }

    const trimmed = lines.map(trimLine).filter((line) => line.length > 0);
    if (trimmed.some((line) => line.length > MAX_CONDITIONAL_LINE_MOVES)) {
      throw new BadRequestException(
        `At most ${MAX_CONDITIONAL_LINE_MOVES} moves a line`,
      );
    }

    const saved = replace
      ? null
      : await this.sets.findOneBy({ userId, gameId });
    const base = saved?.basePly === basePly ? saved.tree : [];
    let tree;
    try {
      // Checks each move is UCI too, before they're played out below.
      tree = mergeLines(base, trimmed);
    } catch (error) {
      if (error instanceof ConditionalMovesError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    for (const line of trimmed) this.assertLegal(game.fen, line);
    if (linesOf(tree).length > MAX_CONDITIONAL_LINES) {
      throw new BadRequestException(
        `At most ${MAX_CONDITIONAL_LINES} conditional lines`,
      );
    }
    if (tree.length === 0) {
      await this.clear(userId, gameId);
      return { basePly: null, lines: [] };
    }
    await this.sets.upsert({ userId, gameId, basePly, tree, deletedAt: null }, [
      'userId',
      'gameId',
    ]);
    return { basePly, lines: linesOf(tree) };
  }

  async clear(userId: string, gameId: string): Promise<void> {
    await this.sets.softDelete({ userId, gameId });
  }

  private assertLegal(fen: string, line: string[]): void {
    const engine = new ServerChessEngine(fen);
    for (const uci of line) {
      const { from, to, promotion } = fromUci(uci);
      let outcome;
      try {
        outcome = engine.attemptMove(
          from as Square,
          to as Square,
          promotion as PieceSymbol | undefined,
        );
      } catch {
        outcome = { status: 'illegal' as const };
      }
      if (outcome.status !== 'ok') {
        throw new BadRequestException(`Illegal move in a line: ${uci}`);
      }
    }
  }
}
