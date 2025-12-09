import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', unique: true })
  telegram_user_id: number;

  /**
   * Username пользователя Telegram (без @).
   * TODO: Учесть возможное изменение имени.
   * При изменении username в Telegram, старые записи в БД могут содержать устаревший username.
   * Это может привести к тому, что в отчётах будет отображаться старое имя пользователя.
   * Решение: всегда обновлять username при каждом upsert пользователя.
   */
  @Column({ type: 'varchar', nullable: true })
  username: string | null;
}
