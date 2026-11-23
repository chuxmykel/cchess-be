import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/** What a link sent by email does: confirm the account's address, switch
 * it to a new one, or set a new password. */
export type EmailTokenPurpose = 'verify' | 'change' | 'reset';

/** A single-use link sent by email. Only its hash is kept, as for refresh
 * tokens: the raw value lives in the email alone. */
@Entity('email_tokens')
export class EmailToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_email_tokens_userId',
  })
  user!: Relation<User>;

  @Column('uuid')
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  purpose!: EmailTokenPurpose;

  @Index('IDX_email_tokens_tokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  /** The address the link was sent to - the new one, for a change. */
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
