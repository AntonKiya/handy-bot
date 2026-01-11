import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CoreChannelUsersRunStatus {
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
}

@Entity({ name: 'core_channel_users_runs' })
@Index(['userId', 'status', 'startedAt'])
@Index(['userId', 'startedAt'])
export class CoreChannelUsersRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Telegram user id (ctx.from.id). bigint → TypeORM обычно отдаёт string */
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  /** Telegram chat id канала (-100...). bigint → TypeORM обычно отдаёт string */
  @Column({ name: 'channel_telegram_chat_id', type: 'bigint' })
  channelTelegramChatId!: string;

  /** Как ввёл пользователь: "@channel_name" */
  @Column({ name: 'channel_username', type: 'varchar', length: 255 })
  channelUsername!: string;

  /** Период: "14d", "90d" */
  @Column({ name: 'period', type: 'varchar', length: 16 })
  period!: string;

  /** Момент старта (используем для лимита 24h) */
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({
    name: 'status',
    type: 'enum',
    enum: CoreChannelUsersRunStatus,
    default: CoreChannelUsersRunStatus.Running,
  })
  status!: CoreChannelUsersRunStatus;

  /** Текст ошибки при failed (обрезать в сервисе) */
  @Column({ name: 'error', type: 'text', nullable: true })
  error!: string | null;

  /** Техническое поле — дата создания записи */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
