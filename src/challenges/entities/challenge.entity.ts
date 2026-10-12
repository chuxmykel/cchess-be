import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
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

  @Column({ type: 'int' })
  minutes!: number;

  @Column({ type: 'int' })
  incrementSeconds!: number;

  /** Color the *challenger* wants to play; 'random' is resolved on accept. */
  @Column({ type: 'varchar', length: 8, default: 'random' })
  challengerColor!: ColorPreference;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: ChallengeStatus;

  @Column({ type: 'varchar', nullable: true })
  gameId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;
}
