import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreChannelUsersComment } from './core-channel-users-comment.entity';
import { CoreChannelUsersPostCommentsSync } from './core-channel-users-post-comments-sync.entity';
import { CoreChannelUsersService } from './core-channel-users.service';
import { ChannelPost } from '../../core-modules/channel-posts/channel-post.entity';
import { User } from '../../core-modules/user/user.entity';
import { CoreChannelUsersChannelSync } from './core-channel-users-channel-sync.entity';
import { CoreChannelUsersFlow } from './core-channel-users.flow';
import { MenuModule } from '../../core-modules/menu/menu.module';
import { UserChannelsModule } from '../../core-modules/user-channels/user-channels.module';
import { TelegramCoreModule } from '../../../telegram-core/telegram-core.module';
import { Channel } from '../../core-modules/channel/channel.entity';
import { StateModule } from '../../../common/state/state.module';
import { CoreChannelUsersRunEntity } from './core-channel-users-run.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoreChannelUsersComment,
      CoreChannelUsersPostCommentsSync,
      ChannelPost,
      User,
      CoreChannelUsersChannelSync,
      Channel,
      CoreChannelUsersRunEntity,
    ]),
    StateModule,
    MenuModule,
    UserChannelsModule,
    TelegramCoreModule,
  ],
  providers: [CoreChannelUsersService, CoreChannelUsersFlow],
  exports: [CoreChannelUsersService, CoreChannelUsersFlow],
})
export class CoreChannelUsersModule {}
