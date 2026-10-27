import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

export type ChallengeStatus =
  'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type ColorPreference = 'white' | 'black' | 'random';

@Entity('challenges')
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  challenger!: Relation<User>;

  @Column()
  challengerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  opponent!: Relation<User>;

  @Column()
  opponentId!: string;

  // double precision, not int - minutes is fractional (e.g. 5 seconds is
  // 5/60 ≈ 0.08333), see chess/time-control.ts.
  @Column({ type: 'double precision' })
  minutes!: number;

  @Column({ type: 'int' })
  incrementSeconds!: number;

  /** Color the *challenger* wants to play; 'random' is resolved on accept. */
  @Column({ type: 'varchar', length: 8, default: 'random' })
  challengerColor!: ColorPreference;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: ChallengeStatus;

  @Column({ type: 'boolean', default: true })
  rated!: boolean;

  @Column({ type: 'varchar', nullable: true })
  gameId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
