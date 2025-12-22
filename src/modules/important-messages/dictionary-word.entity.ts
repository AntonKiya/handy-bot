import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Channel } from '../channel/channel.entity';

@Entity('dictionary_words')
export class DictionaryWord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  category: 'question' | 'lead' | 'negative';

  @Column({ type: 'varchar' })
  type: 'base' | 'context';

  @Column({ type: 'jsonb' })
  words: string[]; // массив слов/фраз

  @ManyToOne(() => Channel, { nullable: true })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel | null; // NULL для base, заполнено для context

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  // TODO: Добавить индексы для оптимизации поиска:
  // - INDEX на (category, type, channel_id)
  // - INDEX на (category, type) для base словарей
}
