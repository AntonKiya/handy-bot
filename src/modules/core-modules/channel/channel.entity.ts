import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Идентификатор чата (-1042...).
   */
  @Column({ type: 'bigint', unique: true })
  telegram_chat_id: number;

  @Column({ type: 'bigint', nullable: true })
  discussion_group_id: number | null;

  /**
   * Username канала (без @).
   * TODO: Учесть возможное изменение имени.
   * Username канала является источником правды для синхронизации с Telegram API.
   * Если пользователь изменит username канала в Telegram, синхронизация будет невозможна до тех пор, пока администратор не обновит его вручную в системе или не переподключит канал.
   * Автоматическое обновление username канала невозможно, так как мы ищем канал именно по username.
   */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  username: string | null;
}
