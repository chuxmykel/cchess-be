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

import type { GameType } from '../../chess/time-control.js';
import { Game } from '../../games/entities/game.entity.js';
import { User } from '../../users/entities/user.entity.js';
import type { BadgeKind } from '../badge-kinds.js';

/**
 * A badge a player earned: in a game - when it ended, or when its review
 * was saved - or a milestone (games played, a rating line crossed), with
 * the game that reached it. Each is earned once, by its `key`.
 */
@Entity('user_badges')
@Index('UQ_user_badges_user_key', ['userId', 'key'], { unique: true })
@Index('IDX_user_badges_user', ['userId', 'createdAt'])
export class UserBadge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_user_badges_user',
  })
  user!: Relation<User>;

  @Column({ type: 'varchar', length: 32 })
  kind!: BadgeKind;

  /** The game that earned it. */
  @Column({ type: 'uuid', nullable: true })
  gameId!: string | null;

  @ManyToOne(() => Game, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'gameId',
    foreignKeyConstraintName: 'FK_user_badges_game',
  })
  game!: Relation<Game> | null;

  /** A rating milestone's category. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  category!: GameType | null;

  /** A milestone's number: games played, or the rating crossed. */
  @Column({ type: 'int', nullable: true })
  value!: number | null;

  /** What makes it one badge: a game badge per game, a milestone once. */
  @Column({ type: 'varchar', length: 80 })
  key!: string;

  /** When it was earned. */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
