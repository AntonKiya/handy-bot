import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { SummaryChannelFlow } from '../../modules/summary-channel/summary-channel.flow';

@Injectable()
export class CallbackRouter {
  private readonly logger = new Logger(CallbackRouter.name);

  constructor(private readonly summaryChannelFlow: SummaryChannelFlow) {}

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

    if (data.startsWith('summary:channel:')) {
      return this.summaryChannelFlow.handleCallback(ctx, data);
    }
  }
}
