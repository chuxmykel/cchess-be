import {
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/** One player blocking another: neither can then friend, challenge, chat
 * with or be paired against the other. Unblocking soft-deletes it; blocking
 * again brings the row back. */
@Entity('user_blocks')
export class UserBlock {
  @PrimaryColumn('uuid')
  blockerId!: string;

  @PrimaryColumn('uuid')
  blockedId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blockerId',
    foreignKeyConstraintName: 'FK_user_blocks_blockerId',
  })
  blocker!: Relation<User>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blockedId',
    foreignKeyConstraintName: 'FK_user_blocks_blockedId',
  })
  blocked!: Relation<User>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
