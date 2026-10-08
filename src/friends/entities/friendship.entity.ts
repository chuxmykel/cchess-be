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

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

@Entity('friendships')
export class Friendship {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  requester!: Relation<User>;

  @Column()
  requesterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  addressee!: Relation<User>;

  @Column()
  addresseeId!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: FriendshipStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  respondedAt!: Date | null;
}
