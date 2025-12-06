import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { SummaryChannelFlow } from '../../modules/summary-channel/summary-channel.flow';
import { SUMMARY_CHANNEL_NAMESPACE } from '../../modules/summary-channel/summary-channel.callbacks';
import { SummaryCommentsFlow } from '../../modules/summary-comments/summary-comments.flow';
import { SUMMARY_COMMENTS_NAMESPACE } from '../../modules/summary-comments/summary-comments.callbacks';
import { UserChannelsFlowService } from '../../modules/user-channels/user-channels-flow.service';
import { CHANNELS_NAMESPACE } from '../../modules/user-channels/user-channels.callbacks';

@Injectable()
export class CallbackRouter {
  private readonly logger = new Logger(CallbackRouter.name);

  constructor(
    private readonly summaryChannelFlow: SummaryChannelFlow,
    private readonly summaryCommentsFlow: SummaryCommentsFlow,
    private readonly userChannelsFlow: UserChannelsFlowService,
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

    if (data.startsWith(`${SUMMARY_COMMENTS_NAMESPACE}:`)) {
      return this.summaryCommentsFlow.handleCallback(ctx, data);
    }

    if (data.startsWith(`${CHANNELS_NAMESPACE}:`)) {
      return this.userChannelsFlow.handleCallback(ctx, data);
    }
  }
}
