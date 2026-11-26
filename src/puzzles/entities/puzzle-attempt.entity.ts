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
import { Puzzle } from './puzzle.entity.js';

/** A player's try at a pool puzzle, and what it did to their puzzle
 * rating - so a puzzle isn't served them again for a while. */
@Entity('puzzle_attempts')
@Index('IDX_puzzle_attempts_user', ['userId', 'createdAt'])
export class PuzzleAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_puzzle_attempts_user',
  })
  user!: Relation<User>;

  @Column({ type: 'varchar', length: 16 })
  puzzleId!: string;

  @ManyToOne(() => Puzzle, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'puzzleId',
    foreignKeyConstraintName: 'FK_puzzle_attempts_puzzle',
  })
  puzzle!: Relation<Puzzle>;

  @Column({ type: 'boolean' })
  solved!: boolean;

  @Column({ type: 'real' })
  ratingBefore!: number;

  @Column({ type: 'real' })
  ratingAfter!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
