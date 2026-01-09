import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SummaryChannelResultEntity } from './summary-channel-result.entity';

export enum SummaryChannelRunStatus {
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
}

@Entity({ name: 'summary_channel_runs' })
@Index(['userId', 'isImmediateRun', 'status', 'startedAt'])
export class SummaryChannelRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Telegram user id (в твоём проекте userId = ctx.from.id) */
  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  /** FK на channels.telegram_chat_id (как bigint → TypeORM обычно отдаёт string) */
  @Column({ name: 'channel_telegram_chat_id', type: 'bigint' })
  channelTelegramChatId!: string;

  @Column({ name: 'is_immediate_run', type: 'boolean', default: false })
  isImmediateRun!: boolean;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SummaryChannelRunStatus,
    default: SummaryChannelRunStatus.Running,
  })
  status!: SummaryChannelRunStatus;

  @Column({ name: 'error', type: 'text', nullable: true })
  error!: string | null;

  /** Техническое поле — дата создания записи */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => SummaryChannelResultEntity, (r) => r.run)
  results!: SummaryChannelResultEntity[];
}
