import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A puzzle from lichess's puzzle database (CC0), imported a slice at a time
 * (npm run puzzles:import). As lichess gives it: `fen` is the position
 * before the opponent's move, the first of `moves`; the solver plays the
 * second, the fourth and so on - each the only move that works, but for
 * mate in one, where any mate does.
 */
@Entity('puzzles')
export class Puzzle {
  /** Lichess's own id, e.g. 00sHx. */
  @PrimaryColumn({ type: 'varchar', length: 16 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  fen!: string;

  /** UCI, space-separated: the opponent's move, then the solution. */
  @Column({ type: 'text' })
  moves!: string;

  @Index('IDX_puzzles_rating')
  @Column({ type: 'int' })
  rating!: number;

  @Column({ type: 'int' })
  ratingDeviation!: number;

  /** From -100 to 100, lichess's players' votes. */
  @Column({ type: 'int' })
  popularity!: number;

  @Column({ type: 'int' })
  nbPlays!: number;

  /** Lichess's theme names: fork, pin, mateIn2, ... */
  @Column({ type: 'text', array: true })
  themes!: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
