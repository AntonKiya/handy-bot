import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoreChannelUsersComment } from './core-channel-users-comment.entity';
import { CoreChannelUsersPostCommentsSync } from './core-channel-users-post-comments-sync.entity';

@Injectable()
export class CoreChannelUsersService {
  constructor(
    @InjectRepository(CoreChannelUsersComment)
    private readonly coreChannelUsersCommentRepository: Repository<CoreChannelUsersComment>,
    @InjectRepository(CoreChannelUsersPostCommentsSync)
    private readonly coreChannelUsersPostCommentsSyncRepository: Repository<CoreChannelUsersPostCommentsSync>,
  ) {}
}
