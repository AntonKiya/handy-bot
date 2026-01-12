import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { SummaryChannelFlow } from '../../modules/feature-modules/summary-channel/summary-channel.flow';
import { SUMMARY_CHANNEL_NAMESPACE } from '../../modules/feature-modules/summary-channel/summary-channel.callbacks';
import { CORE_CHANNEL_USERS_NAMESPACE } from '../../modules/feature-modules/core-channel-users/core-channel-users.callbacks';
import { CoreChannelUsersFlow } from '../../modules/feature-modules/core-channel-users/core-channel-users.flow';
import { ImportantMessagesFlow } from '../../modules/feature-modules/important-messages/important-messages.flow';
import { IMPORTANT_MESSAGES_NAMESPACE } from '../../modules/feature-modules/important-messages/important-messages.callbacks';
import { UserService } from '../../modules/core-modules/user/user.service';

@Injectable()
export class CallbackRouter {
  private readonly logger = new Logger(CallbackRouter.name);

  constructor(
    private readonly summaryChannelFlow: SummaryChannelFlow,
    private readonly coreChannelUsersFlow: CoreChannelUsersFlow,
    private readonly importantMessagesFlow: ImportantMessagesFlow,
    private readonly userService: UserService,
  ) {}

  async route(ctx: Context) {
    const telegramUserId = ctx.from?.id;
    if (telegramUserId) {
      await this.userService.upsertTelegramUser(
        telegramUserId,
        ctx.from?.username ?? null,
      );
    }

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

    if (data.startsWith(`${CORE_CHANNEL_USERS_NAMESPACE}:`)) {
      return this.coreChannelUsersFlow.handleCallback(ctx, data);
    }

    if (data.startsWith(`${IMPORTANT_MESSAGES_NAMESPACE}:`)) {
      return this.importantMessagesFlow.handleCallback(ctx, data);
    }
  }
}
