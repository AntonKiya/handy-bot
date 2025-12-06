import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ChannelPost } from '../channel-posts/channel-post.entity';
import { User } from '../user/user.entity';

@Entity('core_channel_users_comments')
export class CoreChannelUsersComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ChannelPost, { nullable: false })
  @JoinColumn({ name: 'post_id' })
  post: ChannelPost;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'timestamp' })
  commented_at: Date;
}
