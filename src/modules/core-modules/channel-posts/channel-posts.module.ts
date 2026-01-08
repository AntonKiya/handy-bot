import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelPost } from './channel-post.entity';
import { ChannelPostsService } from './channel-posts.service';
import { Channel } from '../channel/channel.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ChannelPost, Channel])],
  providers: [ChannelPostsService],
  exports: [ChannelPostsService],
})
export class ChannelPostsModule {}
