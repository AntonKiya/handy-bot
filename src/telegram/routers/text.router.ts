import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { UserStateService } from '../../common/state/user-state.service';
import { SummaryChannelFlow } from '../../modules/summary-channel/summary-channel.flow';

@Injectable()
export class TextRouter {
  private readonly logger = new Logger(TextRouter.name);

  constructor(
    private readonly userStateService: UserStateService,
    private readonly summaryChannelFlow: SummaryChannelFlow,
  ) {}

  async route(ctx: Context) {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const userId = ctx.from?.id;

    if (!userId || !text) {
      return;
    }

    const state = await this.userStateService.get(userId);

    if (!state) {
      this.logger.debug(
        `No active state for user ${userId}, text ignored at this stage`,
      );
    }

    if (state?.scope === 'summary:channel') {
      this.logger.debug(
        `Routing text to SummaryChannelFlow for user ${userId}, step: ${state.step}`,
      );
      return this.summaryChannelFlow.handleState(ctx, text, state);
    }
  }
}
