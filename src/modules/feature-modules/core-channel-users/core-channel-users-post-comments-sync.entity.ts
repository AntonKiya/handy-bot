import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { ChannelPost } from '../../core-modules/channel-posts/channel-post.entity';

@Entity('core_channel_users_post_comments_sync')
export class CoreChannelUsersPostCommentsSync {
  @PrimaryColumn('uuid')
  post_id: string;

  @OneToOne(() => ChannelPost, { nullable: false })
  @JoinColumn({ name: 'post_id' })
  post: ChannelPost;

  @Column({ type: 'timestamp' })
  last_synced_at: Date;
}
