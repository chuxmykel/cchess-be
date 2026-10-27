import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import { Game } from './game.entity.js';

export const MAX_CHAT_MESSAGE_LENGTH = 140;

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

  @Column()
  userId!: string;

  @Column({ type: 'varchar', length: MAX_CHAT_MESSAGE_LENGTH })
  text!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
