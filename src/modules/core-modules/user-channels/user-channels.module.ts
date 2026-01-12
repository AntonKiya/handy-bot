import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserChannel } from './user-channel.entity';
import { User } from '../user/user.entity';
import { Channel } from '../channel/channel.entity';
import { UserChannelsService } from './user-channels.service';
import { MenuModule } from '../menu/menu.module';
import { ChannelModule } from '../channel/channel.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserChannel, User, Channel]),
    MenuModule,
    ChannelModule,
  ],
  providers: [UserChannelsService],
  exports: [UserChannelsService],
})
export class UserChannelsModule {}
