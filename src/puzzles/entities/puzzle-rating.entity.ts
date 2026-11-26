import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import {
  STARTING_DEVIATION,
  STARTING_RATING,
  STARTING_VOLATILITY,
} from '../../users/entities/rating.entity.js';

/** A player's puzzle rating: Glicko-2, each attempt at a pool puzzle a game
 * against the puzzle's own rating. Kept apart from the game ratings, which
 * profiles and rating stats read as game categories. */
@Entity('puzzle_ratings')
export class PuzzleRating {
  @PrimaryColumn('uuid')
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_puzzle_ratings_user',
  })
  user!: Relation<User>;

  @Column({ type: 'double precision', default: STARTING_RATING })
  rating!: number;

  @Column({ type: 'double precision', default: STARTING_DEVIATION })
  deviation!: number;

  @Column({ type: 'double precision', default: STARTING_VOLATILITY })
  volatility!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastRatedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
