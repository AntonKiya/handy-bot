import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ChannelPost } from '../../core-modules/channel-posts/channel-post.entity';
import { User } from '../../core-modules/user/user.entity';

export type CoreCommentAuthorType = 'user' | 'channel' | 'chat';

@Entity('core_channel_users_comments')
@Index('core_comments_post_comment_unique', ['post', 'telegram_comment_id'], {
  unique: true,
})
export class CoreChannelUsersComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ChannelPost, { nullable: false })
  @JoinColumn({ name: 'post_id' })
  post: ChannelPost;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Идентификатор сообщения комментария в рамках канала (id из Telegram / Core API).
   * Уникален только в связке с post (каналом)
   */
  @Column({ type: 'bigint' })
  telegram_comment_id: number;

  /**
   * Тип автора комментария:
   * - 'user'    — обычный пользователь или бот (PeerUser)
   * - 'channel' — комментарий от лица канала (своего или чужого, PeerChannel)
   * - 'chat'    — комментарий от PeerChat
   */
  @Column({ type: 'varchar', length: 16 })
  author_type: CoreCommentAuthorType;

  /**
   * Время публикации комментария (по данным Telegram).
   */
  @Column({ type: 'timestamp' })
  commented_at: Date;
}
