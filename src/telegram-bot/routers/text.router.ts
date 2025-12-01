import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { UserStateService } from '../../common/state/user-state.service';
import { SummaryChannelFlow } from '../../modules/summary-channel/summary-channel.flow';
import { SummaryCommentsFlow } from '../../modules/summary-comments/summary-comments.flow';

@Injectable()
export class TextRouter {
  private readonly logger = new Logger(TextRouter.name);

  constructor(
    private readonly userStateService: UserStateService,
    private readonly summaryChannelFlow: SummaryChannelFlow,
    private readonly summaryCommentsFlow: SummaryCommentsFlow,
  ) {}

  async route(ctx: Context) {
    const userId = ctx.from?.id;
    const text =
      'text' in ctx.message && typeof ctx.message.text === 'string'
        ? ctx.message.text
        : '';

    if (!userId || !text) {
      return;
    }

    const state = await this.userStateService.get(userId);

    if (!state) {
      this.logger.debug(
        `No state for user ${userId}. Text: "${text}". Skipping state flows.`,
      );
      return;
    }

    switch (state.scope) {
      case 'summary:channel':
        return this.summaryChannelFlow.handleState(ctx, text, state);

      case 'summary:comments':
        return this.summaryCommentsFlow.handleState(ctx, text, state);

      default:
        this.logger.warn(
          `Unknown state.scope "${state.scope}" for user ${userId}`,
        );
        return;
    }
  }
}
