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

import type { LichessPayload } from '../lichess/lichess-explorer.client.js';
import { ExplorerPosition } from './explorer-position.entity.js';

/** Lichess's answer for a position, as last fetched. Soft-deleted once its
 * position has gone unopened for 90 days (unless pinned), and purged 30
 * days after that - see ExplorerSweeper. */
@Entity('explorer_cache')
export class ExplorerCacheEntry {
  @PrimaryColumn('uuid')
  positionId!: string;

  @OneToOne(() => ExplorerPosition, (position) => position.cache, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'positionId' })
  position!: Relation<ExplorerPosition>;

  /** json, not jsonb: only ever read whole, and half the size. */
  @Column({ type: 'json' })
  payload!: LichessPayload;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
