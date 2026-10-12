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

import { Game } from './game.entity.js';

@Entity('moves')
@Index(['game', 'ply'], { unique: true })
export class Move {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Game, (game) => game.moves, { onDelete: 'CASCADE' })
  @JoinColumn()
  game!: Relation<Game>;

  @Column()
  gameId!: string;

  /** 1-indexed half-move number: white's first move is 1, black's reply is 2. */
  @Column({ type: 'int' })
  ply!: number;

  @Column({ type: 'varchar', length: 2 })
  from!: string;

  @Column({ type: 'varchar', length: 2 })
  to!: string;

  @Column({ type: 'varchar', length: 1 })
  piece!: string;

  @Column({ type: 'varchar', length: 1 })
  color!: 'w' | 'b';

  @Column({ type: 'varchar', length: 16 })
  san!: string;

  @Column({ type: 'varchar', length: 1, nullable: true })
  captured!: string | null;

  @Column({ type: 'varchar', length: 1, nullable: true })
  promotion!: string | null;

  @Column({ type: 'varchar' })
  fenAfter!: string;

  /** The mover's own clock remaining immediately after this move (post-increment). */
  @Column({ type: 'int' })
  clockAfterMs!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
