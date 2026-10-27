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
import { User } from './user.entity.js';

export const STARTING_RATING = 1500;
export const STARTING_DEVIATION = 350;
export const STARTING_VOLATILITY = 0.06;
export const PROVISIONAL_DEVIATION = 110;

export function isProvisional(deviation: number | null): boolean {
  return deviation !== null && deviation > PROVISIONAL_DEVIATION;
}

@Entity('ratings')
@Index(['user', 'category'], { unique: true })
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: Relation<User>;

  @Column()
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  category!: GameType;

  @Column({ type: 'double precision', default: STARTING_RATING })
  rating!: number;

  @Column({ type: 'double precision', default: STARTING_DEVIATION })
  deviation!: number;

  @Column({ type: 'double precision', default: STARTING_VOLATILITY })
  volatility!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastRatedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  gamesPlayed!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
