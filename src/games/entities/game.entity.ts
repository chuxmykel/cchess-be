import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import type { GameType } from '../../chess/time-control.js';
import { User } from '../../users/entities/user.entity.js';
import { Move } from './move.entity.js';

export type GameStatus = 'active' | 'completed' | 'aborted';
export type GameResult = 'white' | 'black' | 'draw' | null;
export type GameResultReason =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'stalemate'
  | 'draw-agreement'
  | 'threefold-repetition'
  | 'insufficient-material'
  | 'fifty-move-rule'
  | 'abandonment'
  | 'abort'
  | null;
export type DrawOfferBy = 'white' | 'black' | null;

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

@Entity('games')
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  white!: Relation<User>;

  @Column()
  whiteId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  black!: Relation<User>;

  @Column()
  blackId!: string;

  // double precision, not int - minutes is fractional (e.g. 5 seconds is
  // 5/60 ≈ 0.08333), see chess/time-control.ts.
  @Column({ type: 'double precision' })
  minutes!: number;

  @Column({ type: 'int' })
  incrementSeconds!: number;

  @Column({ type: 'varchar', length: 16 })
  gameType!: GameType;

  @Column({ type: 'boolean', default: true })
  rated!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: GameStatus;

  @Column({ type: 'varchar', length: 8, nullable: true })
  result!: GameResult;

  @Column({ type: 'varchar', length: 32, nullable: true })
  resultReason!: GameResultReason;

  @Column({ type: 'varchar' })
  fen!: string;

  @Column({ type: 'text', default: '' })
  pgn!: string;

  @Column({ type: 'int' })
  whiteTimeRemainingMs!: number;

  @Column({ type: 'int' })
  blackTimeRemainingMs!: number;

  @Column({ type: 'varchar', length: 1, default: 'w' })
  turn!: 'w' | 'b';

  @Column({ type: 'timestamptz', nullable: true })
  lastMoveAt!: Date | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  drawOfferedBy!: DrawOfferBy;

  @OneToMany(() => Move, (move) => move.game)
  moves!: Move[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
