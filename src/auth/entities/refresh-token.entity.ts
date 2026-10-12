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

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: Relation<User>;

  @Column()
  userId!: string;

  /** SHA-256 hash of the raw refresh token - the raw value is only ever
   * seen by the client, so a leaked DB can't be replayed as valid tokens. */
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'boolean', default: false })
  revoked!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
