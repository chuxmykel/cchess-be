import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import type { LichessDb } from '../lichess/lichess-explorer.client.js';
import { ExplorerCacheEntry } from './explorer-cache-entry.entity.js';

/** A position looked up in one of lichess's databases, with the default
 * filters - kept for good, how often it's opened and all, whether or not
 * its answer still is (`ExplorerCacheEntry`). */
@Entity('explorer_positions')
@Unique('UQ_explorer_positions_db_epd', ['db', 'epd'])
export class ExplorerPosition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  db!: LichessDb;

  /** The position, as a FEN's first four fields - moves.positionKey's
   * form. */
  @Column({ type: 'varchar', length: 100 })
  epd!: string;

  @Column({ type: 'int', default: 0 })
  hits!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastOpenedAt!: Date | null;

  /** Kept from lichess however long it goes unopened, and refreshed each
   * month: the opening book's positions (seed-positions.ts). */
  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  @OneToOne(() => ExplorerCacheEntry, (entry) => entry.position)
  cache?: Relation<ExplorerCacheEntry>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
