import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Game } from '../games/entities/game.entity.js';
import { PersonalPuzzle } from './entities/personal-puzzle.entity.js';
import { PuzzleAttempt } from './entities/puzzle-attempt.entity.js';
import { PuzzleRating } from './entities/puzzle-rating.entity.js';
import { Puzzle } from './entities/puzzle.entity.js';
import { PuzzlesController } from './puzzles.controller.js';
import { PuzzlesService } from './puzzles.service.js';

/** Puzzles: lichess's, imported to a pool and served near each player's
 * puzzle rating; and the tactics players missed in their own games, kept to
 * practise on a spaced schedule. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Puzzle,
      PuzzleAttempt,
      PuzzleRating,
      PersonalPuzzle,
      Game,
    ]),
  ],
  controllers: [PuzzlesController],
  providers: [PuzzlesService],
})
export class PuzzlesModule {}
