import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Channel } from '../channel/channel.entity';

export enum UserChannelFeature {
  SUMMARY_CHANNEL = 'summary-channel',
  CORE_CHANNEL_USERS = 'core-channel-users',
}

@Entity('user_channels')
@Unique('UQ_user_channels_user_id_channel_id', ['user', 'channel'])
export class UserChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Channel, { nullable: false })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  // @Column({
  //   name: 'feature',
  //   type: 'enum',
  //   enum: UserChannelFeature,
  //   nullable: false,
  // })
  // feature: UserChannelFeature;

  @Column({ name: 'is_admin', type: 'boolean', default: false })
  is_admin: boolean;
}
