import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import type { ReviewDigests } from '../review-digests.js';
import { Game } from './game.entity.js';

/** A score as the app's engine reports it, from white's side: centipawns,
 * or a mate in so many moves for one side. */
export type ReviewScore =
  | { kind: 'cp'; cp: number }
  | { kind: 'mate'; moves: number; winner: 'w' | 'b' };

/** The engine's word on one position of a game. */
export interface PositionEval {
  score: ReviewScore;
  /** The best line, in UCI - none once the game's over. */
  pv: string[];
  /** The next best move's score, if there was another. */
  second: ReviewScore | null;
  depth: number;
}

/**
 * A finished game's review: the engine's evaluation of every position,
 * worked out on the device of whoever asked for it first (see docs/features.md, "Game
 * review"), and kept so nobody has to again. The app derives each move's
 * class and comment from the evals; the accuracies are kept as columns for
 * game lists.
 */
@Entity('game_reviews')
export class GameReview {
  @PrimaryColumn('uuid')
  gameId!: string;

  @OneToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gameId',
    foreignKeyConstraintName: 'FK_game_reviews_game',
  })
  game!: Relation<Game>;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_game_reviews_created_by',
  })
  createdBy!: Relation<User> | null;

  /** The engine and build, e.g. stockfish-19.0.1-lite-single. */
  @Column({ type: 'varchar', length: 64 })
  engine!: string;

  /** The shallowest depth any position was searched to. */
  @Column({ type: 'int' })
  depth!: number;

  @Column({ type: 'real' })
  whiteAccuracy!: number;

  @Column({ type: 'real' })
  blackAccuracy!: number;

  /** Every position's eval, the start first. */
  @Column({ type: 'jsonb' })
  evals!: PositionEval[];

  /** Each side's review boiled down (review-digests.ts), for players'
   * patterns and badges - none until the app has sent them. */
  @Column({ type: 'jsonb', nullable: true })
  digests!: ReviewDigests | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
