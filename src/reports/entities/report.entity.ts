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

export const REPORT_REASONS = [
  'abuse',
  'hate',
  'sexual',
  'spam',
  'cheating',
  'username',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = 'open' | 'resolved';
export const MAX_REPORT_DETAILS_LENGTH = 500;

/** A player reporting another - for something said in a game's chat or a
 * direct message, or just the player. A copy of the message is kept, so
 * it's there to judge even once deleted. */
@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'reporterId',
    foreignKeyConstraintName: 'FK_reports_reporterId',
  })
  reporter!: Relation<User>;

  @Column('uuid')
  reporterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'reportedUserId',
    foreignKeyConstraintName: 'FK_reports_reportedUserId',
  })
  reportedUser!: Relation<User>;

  @Column('uuid')
  reportedUserId!: string;

  @Column({ type: 'varchar', length: 16 })
  reason!: ReportReason;

  @Column({
    type: 'varchar',
    length: MAX_REPORT_DETAILS_LENGTH,
    nullable: true,
  })
  details!: string | null;

  @Column({ type: 'uuid', nullable: true })
  gameId!: string | null;

  /** The reported message - a game chat message or a direct message. */
  @Column({ type: 'uuid', nullable: true })
  messageId!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  messageText!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: ReportStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
