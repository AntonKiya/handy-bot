import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserChannel } from './user-channel.entity';
import { User } from '../user/user.entity';
import { Channel } from '../channel/channel.entity';
import { UserChannelsService } from './user-channels.service';
import { UserChannelsFlowService } from './user-channels-flow.service';
import { MenuModule } from '../menu/menu.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserChannel, User, Channel]), MenuModule],
  providers: [UserChannelsService, UserChannelsFlowService],
  exports: [UserChannelsService, UserChannelsFlowService],
})
export class UserChannelsModule {}
