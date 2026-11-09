import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/** The one row's id. */
export const LICHESS_FETCH_STATE_ID = 1;

/** What the lichess queue has learned of lichess's rate limit - the gap
 * between the cache's requests, how close to the limit it may come, and
 * any pause under way - so a restart doesn't start from scratch. One row,
 * written by the fetcher worker as it changes (see LichessFetchQueue's
 * FetchQueueState). */
@Entity('lichess_fetch_state')
export class LichessFetchState {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'int' })
  gapMs!: number;

  @Column({ type: 'int' })
  floorMs!: number;

  @Column({ type: 'timestamptz', nullable: true })
  floorSetAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  rateLimitedInARow!: number;

  @Column({ type: 'timestamptz', nullable: true })
  pausedUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
