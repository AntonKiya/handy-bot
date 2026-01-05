import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { SummaryChannelFlow } from '../../modules/summary-channel/summary-channel.flow';
import { SUMMARY_CHANNEL_NAMESPACE } from '../../modules/summary-channel/summary-channel.callbacks';
import { UserChannelsFlowService } from '../../modules/user-channels/user-channels-flow.service';
import { CHANNELS_NAMESPACE } from '../../modules/user-channels/user-channels.callbacks';
import { CORE_CHANNEL_USERS_NAMESPACE } from '../../modules/core-channel-users/core-channel-users.callbacks';
import { CoreChannelUsersFlow } from '../../modules/core-channel-users/core-channel-users.flow';
import { ImportantMessagesFlow } from '../../modules/important-messages/important-messages.flow';
import { IMPORTANT_MESSAGES_NAMESPACE } from '../../modules/important-messages/important-messages.callbacks';

@Injectable()
export class CallbackRouter {
  private readonly logger = new Logger(CallbackRouter.name);

  constructor(
    private readonly summaryChannelFlow: SummaryChannelFlow,
    private readonly userChannelsFlow: UserChannelsFlowService,
    private readonly coreChannelUsersFlow: CoreChannelUsersFlow,
    private readonly importantMessagesFlow: ImportantMessagesFlow,
  ) {}

  async route(ctx: Context) {
    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : '';

    this.logger.debug(
      `Received callback_query from user ${ctx.from?.id}: "${data}"`,
    );

    if (!data) {
      return;
    }

    if (data.startsWith(`${SUMMARY_CHANNEL_NAMESPACE}:`)) {
      return this.summaryChannelFlow.handleCallback(ctx, data);
    }

    if (data.startsWith(`${CHANNELS_NAMESPACE}:`)) {
      return this.userChannelsFlow.handleCallback(ctx, data);
    }

    if (data.startsWith(`${CORE_CHANNEL_USERS_NAMESPACE}:`)) {
      return this.coreChannelUsersFlow.handleCallback(ctx, data);
    }

    if (data.startsWith(`${IMPORTANT_MESSAGES_NAMESPACE}:`)) {
      return this.importantMessagesFlow.handleCallback(ctx, data);
    }
  }
}
