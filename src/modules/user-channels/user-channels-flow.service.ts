import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import {
  HandleMyChatMemberResult,
  UserChannelsService,
} from './user-channels.service';
import { MenuService } from '../menu/menu.service';
import { ChannelsAction, CHANNELS_CB } from './user-channels.callbacks';

@Injectable()
export class UserChannelsFlowService {
  private readonly logger = new Logger(UserChannelsFlowService.name);

  constructor(
    private readonly userChannelsService: UserChannelsService,
    private readonly menuService: MenuService,
  ) {}

  async handleMyChatMember(ctx: Context, update: any) {
    const chat = update.chat;
    this.logger.debug(
      `my_chat_member received for chat ${chat.id} (type=${chat.type})`,
    );

    const result: HandleMyChatMemberResult =
      await this.userChannelsService.handleMyChatMember(ctx, update);

    const actorTelegramId = update.from?.id as number | undefined;

    switch (result.type) {
      case 'linked': {
        const title =
          result.data.channelTitle ?? `Канал с id ${result.data.channelId}`;

        // Отправка сообщение в ЛС пользователю,
        // если он когда-то вызывал /start и разрешил диалог
        if (actorTelegramId) {
          try {
            await ctx.telegram.sendMessage(
              actorTelegramId,
              `✅ Канал "${title}" подключён.\nТеперь он доступен в разделе "Мои каналы".`,
            );
          } catch (e) {
            this.logger.warn(
              `Failed to send DM to user ${actorTelegramId} about linked channel`,
            );
          }
        }

        break;
      }

      case 'skipped': {
        this.logger.debug(
          `handleMyChatMember skipped with reason="${result.reason}"`,
        );

        if (result.reason === 'actor-not-admin' && actorTelegramId) {
          try {
            await ctx.telegram.sendMessage(
              actorTelegramId,
              'Вы должны быть администратором или владельцем канала, чтобы подключить его к боту.',
            );
          } catch (e) {
            this.logger.warn(
              `Failed to send DM to user ${actorTelegramId} about actor-not-admin status`,
            );
          }
        }

        break;
      }
    }
  }

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
