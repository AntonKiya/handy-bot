import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Channel } from '../channel/channel.entity';

@Entity('important_messages')
@Index(
  'important_messages_channel_telegram_message',
  ['channel', 'telegram_message_id'],
  { unique: true },
)
export class ImportantMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Channel, { nullable: false })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ name: 'telegram_message_id', type: 'bigint' })
  telegram_message_id: number;

  @Column({ name: 'telegram_user_id', type: 'bigint' })
  telegram_user_id: number; // Автор сообщения из Telegram

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @Column({ name: 'notified_at', type: 'timestamp', nullable: true })
  notified_at: Date | null;

  // TODO: Добавить индексы для оптимизации:
  // - INDEX на (channel_id, created_at) для выборки последних сообщений
}
