import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { UserChannelsService } from './user-channels.service';
import { MenuService } from '../menu/menu.service';
import { ChannelsAction, CHANNELS_CB } from './user-channels.callbacks';

@Injectable()
export class UserChannelsFlowService {
  private readonly logger = new Logger(UserChannelsFlowService.name);

  constructor(
    private readonly userChannelsService: UserChannelsService,
    private readonly menuService: MenuService,
  ) {}

  /**
   * Обработчик всех callback вида "channels:*"
   */
  async handleCallback(ctx: Context, data: string) {
    this.logger.debug(
      `UserChannels callback received: "${data}" from user ${ctx.from?.id}`,
    );

    const parts = data.split(':');
    const action = parts[1];

    switch (action) {
      case ChannelsAction.Open:
      case ChannelsAction.List:
        return this.showMyChannels(ctx);

      case ChannelsAction.AddNew:
        return this.showAddChannelInstruction(ctx);

      case ChannelsAction.Back:
        return this.handleBackToMainMenu(ctx);

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
    }
  }

  /**
   * Экран "Мои каналы"
   */
  private async showMyChannels(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showMyChannels called without userId');
      return;
    }

    const channels = await this.userChannelsService.getChannelsForUser(userId);

    let text: string;
    if (!channels.length) {
      text = 'У вас пока нет подключённых каналов.';
    } else {
      text =
        'Ваши каналы:\n\n' +
        channels
          .map((ch) => {
            // Отображаем username если есть, иначе ID
            const displayName = ch.username
              ? `@${ch.username}`
              : `ID: ${ch.telegramChatId}`;
            return `• ${displayName}`;
          })
          .join('\n');
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Добавить канал', CHANNELS_CB.addNew)],
      [Markup.button.callback('⬅ Назад', CHANNELS_CB.back)],
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
   * Экран "Добавить канал"
   */
  private async showAddChannelInstruction(ctx: Context) {
    const text =
      'Чтобы добавить канал, добавьте этого бота как администратора в нужный канал через настройки Telegram.\n\nПосле этого бот автоматически привяжет канал к вашему аккаунту.\n\nНажмите «Назад», чтобы вернуться в меню.';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅ Назад', CHANNELS_CB.back)],
    ]);

    await ctx.editMessageText(text, {
      ...keyboard,
    });

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  /**
   * Возврат в главное меню
   */
  private async handleBackToMainMenu(ctx: Context) {
    await this.menuService.redrawMainMenu(ctx);

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }
}
