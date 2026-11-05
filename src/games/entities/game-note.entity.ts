import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import { Game } from './game.entity.js';

/** The longest a game's notes may be. */
export const MAX_GAME_NOTE_LENGTH = 4000;

/** A player's own notes on a game - plans for a daily game, say - seen by
 * nobody else. One a game; cleared notes are deleted. */
@Entity('game_notes')
export class GameNote {
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

  @Column({ type: 'varchar', length: MAX_GAME_NOTE_LENGTH })
  body!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
