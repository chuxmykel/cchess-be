import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import type { ConditionalTree } from '../conditional-moves.js';
import { Game } from './game.entity.js';

/** A player's conditional moves in a daily game (see conditional-moves.ts):
 * kept in the database, so they're played however long the opponent
 * takes, restarts and all. One a player a game. */
@Entity('conditional_moves')
export class ConditionalMoveSet {
  @PrimaryColumn('uuid')
  userId!: string;

  @PrimaryColumn('uuid')
  gameId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: Relation<User>;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game!: Relation<Game>;

  /** How many moves the game had when the tree was made: the opponent's
   * move it answers is the next. */
  @Column({ type: 'int' })
  basePly!: number;

  @Column({ type: 'jsonb' })
  tree!: ConditionalTree;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
