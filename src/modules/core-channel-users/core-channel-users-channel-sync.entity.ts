import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Channel } from '../channel/channel.entity';

@Entity('core_channel_users_channel_sync')
export class CoreChannelUsersChannelSync {
  /**
   * TODO: добавить поддержку нескольких владельцев канала. Два одновременных запроса могут синкать один канал.
   * Note: Сейчас считаем, что у канала по сути один владелец (один админ,
   * который его подключил) и у канала одна запись синка.
   * В будущем нужно будет поддержать несколько админов для одного канала,
   * но сама таблица sync остаётся всё равно в разрезе канала, а не пользователя.
   */
  @PrimaryColumn('uuid', { name: 'channel_id' })
  channelId: string;

  @OneToOne(() => Channel, { nullable: false })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'timestamp', name: 'last_synced_at' })
  lastSyncedAt: Date;
}
