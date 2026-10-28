import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import { Game } from './game.entity.js';

export const MAX_CHAT_MESSAGE_LENGTH = 140;

/** A player's own words, or a note of something they did in the game -
 * offering, declining or accepting a draw - which has no text of its own. */
export const CHAT_MESSAGE_KINDS = [
  'message',
  'draw-offered',
  'draw-declined',
  'draw-accepted',
] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

@Entity('game_chat_messages')
@Index(['gameId', 'createdAt'])
export class GameChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn()
  game!: Relation<Game>;

  @Column()
  gameId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: Relation<User>;

  /** Who sent it - or, for a note, who did what it notes. */
  @Column()
  userId!: string;

  @Column({ type: 'varchar', length: 16, default: 'message' })
  kind!: ChatMessageKind;

  @Column({ type: 'varchar', length: MAX_CHAT_MESSAGE_LENGTH })
  text!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
