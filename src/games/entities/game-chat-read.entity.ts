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
import { Game } from './game.entity.js';

/** How far a player has read their game's chat - kept apart from the
 * games row, which a game in progress saves whole from its cache. */
@Entity('game_chat_reads')
export class GameChatRead {
  @PrimaryColumn('uuid')
  gameId!: string;

  @PrimaryColumn('uuid')
  userId!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game!: Relation<Game>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: Relation<User>;

  /** Everything in the chat up to here has been seen. */
  @Column({ type: 'timestamptz' })
  readAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
