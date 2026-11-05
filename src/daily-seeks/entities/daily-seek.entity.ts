import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import type { SeekColor } from '../../matchmaking/seek-matching.js';
import { User } from '../../users/entities/user.entity.js';

/** A player looking for a daily game, waiting - days, maybe - for another
 * whose seek agrees with it (see seek-matching.ts). Kept in the database,
 * not memory like a live seek: nobody waits online for one. Deleted when
 * matched or withdrawn. */
@Entity('daily_seeks')
@Index('IDX_daily_seeks_time_control', ['initialSeconds', 'rated'])
export class DailySeek {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: Relation<User>;

  @Column()
  userId!: string;

  /** The days a move, in seconds - a daily time control's initialSeconds. */
  @Column({ type: 'int' })
  initialSeconds!: number;

  @Column({ type: 'boolean' })
  rated!: boolean;

  /** The seeker's daily rating when they posted it; null for a guest. */
  @Column({ type: 'int', nullable: true })
  rating!: number | null;

  /** How far below and above `rating` an opponent may be; null for no
   * limit that side. */
  @Column({ type: 'int', nullable: true })
  ratingBelow!: number | null;

  @Column({ type: 'int', nullable: true })
  ratingAbove!: number | null;

  @Column({ type: 'varchar', length: 8 })
  color!: SeekColor;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
