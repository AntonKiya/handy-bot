import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreChannelUsersComment } from './core-channel-users-comment.entity';
import { CoreChannelUsersPostCommentsSync } from './core-channel-users-post-comments-sync.entity';
import { CoreChannelUsersService } from './core-channel-users.service';
import { ChannelPost } from '../channel-posts/channel-post.entity';
import { User } from '../user/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoreChannelUsersComment,
      CoreChannelUsersPostCommentsSync,
      ChannelPost,
      User,
    ]),
  ],
  providers: [CoreChannelUsersService],
  exports: [CoreChannelUsersService],
})
export class CoreChannelUsersModule {}
