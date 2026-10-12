import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Rating } from './rating.entity.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  username!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 64 })
  displayName!: string;

  @Column({ type: 'boolean', default: false })
  isGuest!: boolean;

  @Column({ type: 'varchar', length: 280, nullable: true })
  bio!: string | null;

  /** A deterministic identicon-style color, not an uploaded file - keeps profile
   * endpoints simple while still giving every user a distinct avatar. */
  @Column({ type: 'varchar', length: 7 })
  avatarColor!: string;

  @OneToMany(() => Rating, (rating) => rating.user)
  ratings!: Rating[];

  /** Updated on login and on realtime gateway connect; powers "last active". */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
