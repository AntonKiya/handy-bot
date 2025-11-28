import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { SummaryChannelService } from './summary-channel.service';
import { UserState } from '../../common/state/user-state.service';

@Injectable()
export class SummaryChannelFlow {
  private readonly logger = new Logger(SummaryChannelFlow.name);

  constructor(private readonly summaryChannelService: SummaryChannelService) {}

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

    await this.summaryChannelService.handleState(userId, text, state);
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
      case 'open':
        return this.showSummaryChannelMenu(ctx);

      case 'list':
        return this.handleListChannels(ctx);

      case 'add-new':
        return this.handleAddChannel(ctx);

      case 'back':
        return this.handleBackToMainMenu(ctx);

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
    }
  }

  /**
   * Показывает подменю для саммари каналов (3 кнопки).
   * Пока только UI, без бизнес-логики.
   */
  private async showSummaryChannelMenu(ctx: Context) {
    const caption = 'Саммари по каналам';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Мои каналы', 'summary:channel:list')],
      [Markup.button.callback('Добавить канал', 'summary:channel:add-new')],
      [Markup.button.callback('⬅ Главное меню', 'summary:channel:back')],
    ]);

    await ctx.editMessageCaption(caption, {
      ...keyboard,
    });

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  /**
   * Заглушка: "Мои каналы"
   */
  private async handleListChannels(ctx: Context) {
    this.logger.debug(
      `SummaryChannel: list channels requested by user ${ctx.from?.id}`,
    );

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery('Функция в разработке');
    }
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

    await ctx.editMessageCaption(message, {
      reply_markup: {
        inline_keyboard: [],
      },
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
    this.logger.debug(
      `SummaryChannel: back to main menu requested by user ${ctx.from?.id}`,
    );

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery('Возврат в главное меню будет реализован позже');
    }
  }
}
