import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelPost } from './channel-post.entity';

@Injectable()
export class ChannelPostsService {
  constructor(
    @InjectRepository(ChannelPost)
    private readonly channelPostRepository: Repository<ChannelPost>,
  ) {}
}
