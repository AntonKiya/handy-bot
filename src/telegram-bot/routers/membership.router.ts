import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { UserChannelsFlowService } from '../../modules/core-modules/user-channels/user-channels-flow.service';

@Injectable()
export class MembershipRouter {
  constructor(
    private readonly userChannelsFlowService: UserChannelsFlowService,
  ) {}

  async route(ctx: Context) {
    // eslint-disable-next-line
    // @ts-ignore
    const update = ctx.update.my_chat_member;
    const chat = update.chat;

    // Только каналы
    if (chat.type === 'channel') {
      return this.userChannelsFlowService.handleMyChatMember(ctx, update);
    }

    return;
  }
}
