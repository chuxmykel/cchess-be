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

import { Game } from '../../games/entities/game.entity.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * A tactic a player missed in one of their own reviewed games, kept to
 * practise: the position before the move, and the line that won - the
 * solver's move first. It comes back on a spaced schedule (schedule.ts):
 * found, a step further on; missed, back to tomorrow; found at the last
 * step, retired as learnt.
 */
@Entity('personal_puzzles')
@Index('UQ_personal_puzzles_user_game_ply', ['userId', 'gameId', 'ply'], {
  unique: true,
})
@Index('IDX_personal_puzzles_due', ['userId', 'dueAt'])
export class PersonalPuzzle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_personal_puzzles_user',
  })
  user!: Relation<User>;

  @Column('uuid')
  gameId!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gameId',
    foreignKeyConstraintName: 'FK_personal_puzzles_game',
  })
  game!: Relation<Game>;

  /** The move missed: 1 for white's first. */
  @Column({ type: 'int' })
  ply!: number;

  /** The position to solve - the solver to move. */
  @Column({ type: 'varchar', length: 100 })
  fen!: string;

  /** The winning line, in UCI: the solver's move, the reply, and so on. */
  @Column({ type: 'text', array: true })
  solution!: string[];

  /** Lichess's theme names, for what kind of tactic it is. */
  @Column({ type: 'text', array: true })
  themes!: string[];

  @Column({ type: 'timestamptz' })
  dueAt!: Date;

  /** How far along the schedule it is: 0 to the last interval's. */
  @Column({ type: 'int', default: 0 })
  step!: number;

  @Column({ type: 'int', default: 0 })
  solvedCount!: number;

  @Column({ type: 'int', default: 0 })
  failedCount!: number;

  /** When it was learnt - found at the schedule's last step. */
  @Column({ type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
