import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { Update } from 'telegraf/types';
import { ImportantMessagesFlow } from '../../modules/feature-modules/important-messages/important-messages.flow';

@Injectable()
export class ReactionRouter {
  private readonly logger = new Logger(ReactionRouter.name);

  constructor(private readonly importantMessagesFlow: ImportantMessagesFlow) {}

  /**
   * Главный метод роутера
   * Вызывается из TelegramBotService
   */
  async route(ctx: Context): Promise<void> {
    const update = ctx.update as Update.MessageReactionUpdate;

    if (!update.message_reaction) {
      this.logger.warn('message_reaction_count is missing in update');
      return;
    }

    try {
      const { chat, message_id, old_reaction, new_reaction } =
        update.message_reaction;

      this.logger.debug(
        `Processing reaction count for message ${message_id} in chat ${chat.id}`,
      );

      await this.importantMessagesFlow.handleReactionCount(
        ctx,
        chat.id,
        message_id,
        old_reaction,
        new_reaction,
      );
    } catch (error) {
      this.logger.error(
        `Error in ReactionRouter: ${error.message}`,
        error.stack,
      );
    }
  }
}
