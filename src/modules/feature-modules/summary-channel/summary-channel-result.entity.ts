import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SummaryChannelRunEntity } from './summary-channel-run.entity';

@Entity({ name: 'summary_channel_results' })
@Index(['runId'])
@Index(['runId', 'telegramPostId'])
export class SummaryChannelResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @ManyToOne(() => SummaryChannelRunEntity, (run) => run.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'run_id' })
  run!: SummaryChannelRunEntity;

  @Column({ name: 'telegram_post_id', type: 'integer' })
  telegramPostId!: number;

  @Column({ name: 'original_text', type: 'text' })
  originalText!: string;

  @Column({ name: 'summary_text', type: 'text' })
  summaryText!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
