import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import {
  SummaryChannelService,
  SummaryChannelStateResult,
} from './summary-channel.service';
import { UserState } from '../../common/state/user-state.service';
import { SummaryChannelAction } from './summary-channel.callbacks';
import { MenuService } from '../menu/menu.service';
import { buildSummaryChannelMenuKeyboard } from './summary-channel.keyboard';

@Injectable()
export class SummaryChannelFlow {
  private readonly logger = new Logger(SummaryChannelFlow.name);

  constructor(
    private readonly summaryChannelService: SummaryChannelService,
    private readonly menuService: MenuService,
  ) {}

  /**
   * Публичный метод, который вызывается из TextRouter.
   * Flow сам не меняет state и не выполняет бизнес-логику —
   * он просто делегирует работу доменному сервису.
   */
  async handleState(ctx: Context, text: string, state: UserState) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleState called without userId');
      return;
    }

    this.logger.debug(
      `SummaryChannelFlow.handleState for user ${userId}, step: ${state.step}, text: "${text}"`,
    );

    const result: SummaryChannelStateResult =
      await this.summaryChannelService.handleState(userId, text, state);

    if (result.type === 'channel-added') {
      await this.showMyChannels(ctx, {
        mode: 'added',
        newChannel: result.newChannel,
        channels: result.channels,
      });

      await this.sendChannelSummaries(ctx, result.newChannel);
    }
  }

  /**
   * Обработчик всех callback’ов вида "summary:channel:*"
   */
  async handleCallback(ctx: Context, data: string) {
    this.logger.debug(
      `SummaryChannel callback received: "${data}" from user ${ctx.from?.id}`,
    );

    const parts = data.split(':'); // ['summary', 'channel', 'open' | 'list' | 'add-new' | 'back']
    const action = parts[2];

    switch (action) {
      case SummaryChannelAction.Open:
        return this.showSummaryChannelMenu(ctx);

      case SummaryChannelAction.List:
        return this.handleListChannels(ctx);

      case SummaryChannelAction.AddNew:
        return this.handleAddChannel(ctx);

      case SummaryChannelAction.Back:
        return this.handleBackToMainMenu(ctx);

      case SummaryChannelAction.CancelAdd:
        return this.handleCancelAdd(ctx);

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
    }
  }

  private async showSummaryChannelMenu(ctx: Context) {
    const text = 'Саммари по каналам';

    const keyboard = buildSummaryChannelMenuKeyboard();

    await ctx.editMessageText(text, {
      ...keyboard,
    });

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  /**
   * Экран "Мои каналы".
   * mode = 'default'  → обычный просмотр
   * mode = 'added'    → канал только что добавлен, показываем success-капшн
   */
  private async showMyChannels(
    ctx: Context,
    options?: {
      mode?: 'default' | 'added';
      newChannel?: string;
      channels?: string[];
    },
  ) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showMyChannels called without userId');
      return;
    }

    const mode = options?.mode ?? 'default';
    const newChannel = options?.newChannel;
    const channels =
      options?.channels ??
      this.summaryChannelService.getChannelsForUser(userId);

    let text: string;

    if (!channels.length) {
      text = 'У вас пока нет каналов для саммари.';
    } else {
      if (mode === 'added' && newChannel) {
        text = `✅ Канал ${newChannel} добавлен.\n\nТекущий список ваших каналов:\n`;
      } else {
        text = 'Ваши каналы:\n';
      }

      text += '\n' + channels.map((c) => `• ${c}`).join('\n');
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Добавить канал', 'summary:channel:add-new')],
      [Markup.button.callback('⬅ Назад', 'summary:channel:open')],
    ]);

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        ...keyboard,
      });

      if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
        await ctx.answerCbQuery();
      }
    } else {
      await ctx.reply(text, {
        ...keyboard,
      });
    }
  }

  /**
   * Заглушка: "Мои каналы"
   */
  private async handleListChannels(ctx: Context) {
    this.logger.debug(
      `SummaryChannel: list channels requested by user ${ctx.from?.id}`,
    );

    await this.showMyChannels(ctx, {
      mode: 'default',
    });
  }

  /**
   * Заглушка: "Добавить канал"
   */
  private async handleAddChannel(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleAddChannel called without userId');
      return;
    }

    this.logger.debug(
      `SummaryChannel: add channel requested by user ${userId}`,
    );

    const { message } =
      await this.summaryChannelService.startAddChannel(userId);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅ Назад', 'summary:channel:cancel-add')],
    ]);

    await ctx.editMessageText(message, {
      ...keyboard,
    });

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  /**
   * Заглушка: "Назад в главное меню"
   * Позже здесь будем звать MenuService и возвращать основное меню.
   */
  private async handleBackToMainMenu(ctx: Context) {
    const userId = ctx.from?.id;
    this.logger.debug(
      `SummaryChannel: back to main menu requested by user ${userId}`,
    );

    await this.menuService.redrawMainMenu(ctx);

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  private async handleCancelAdd(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleCancelAdd called without userId');
      return;
    }

    this.logger.debug(
      `SummaryChannel: cancel add channel requested by user ${userId}`,
    );

    await this.summaryChannelService.cancelAddChannel(userId);

    await this.showSummaryChannelMenu(ctx);

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  /**
   * Вспомогательный метод: запросить саммари для постов канала и отправить в чат в виде:
   *   12345: краткое саммари поста...
   */
  private async sendChannelSummaries(ctx: Context, channelNameWithAt: string) {
    const userId = ctx.from?.id;
    this.logger.debug(
      `Fetching summaries for channel ${channelNameWithAt} for user ${userId}`,
    );

    try {
      const summaries =
        await this.summaryChannelService.getRecentPostSummariesForChannel(
          channelNameWithAt,
        );

      if (!summaries.length) {
        await ctx.reply(
          `There are no suitable text posts in the ${channelNameWithAt} channel for the recent period.`,
        );
        return;
      }

      const lines = summaries.map((item) => `${item.id}: ${item.summary}`);

      const messageText = lines.join('\n\n');

      await ctx.reply(messageText);
    } catch (e) {
      this.logger.error(
        `Failed to send summaries for channel ${channelNameWithAt}`,
        e as any,
      );
      await ctx.reply(
        `Failed to retrieve post summaries for ${channelNameWithAt}. Please try again later.`,
      );
    }
  }
}
