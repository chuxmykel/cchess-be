import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import { Game } from './game.entity.js';

@Entity('bookmarks')
export class Bookmark {
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
