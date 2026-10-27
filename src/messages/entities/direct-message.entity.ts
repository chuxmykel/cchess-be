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

export const MAX_DIRECT_MESSAGE_LENGTH = 500;

@Entity('direct_messages')
@Index(['senderId', 'recipientId', 'createdAt'])
export class DirectMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  sender!: Relation<User>;

  @Column()
  senderId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  recipient!: Relation<User>;

  @Column()
  recipientId!: string;

  @Column({ type: 'varchar', length: MAX_DIRECT_MESSAGE_LENGTH })
  text!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
