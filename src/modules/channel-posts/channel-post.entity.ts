import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Channel } from '../channel/channel.entity';

@Entity('channel_posts')
@Index(['channel', 'telegram_post_id'], { unique: true })
export class ChannelPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Channel, { nullable: false })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'bigint' })
  telegram_post_id: number;

  @Column({ type: 'timestamp' })
  published_at: Date;
}
