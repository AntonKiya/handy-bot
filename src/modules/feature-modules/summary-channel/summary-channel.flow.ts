// src/telegram-bot/features/summary-channel/summary-channel.flow.ts

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { SummaryChannelService } from './summary-channel.service';
import { UserState } from '../../../common/state/user-state.service';
import { SummaryChannelAction } from './summary-channel.callbacks';
import { MenuService } from '../../core-modules/menu/menu.service';
import {
  buildSummaryChannelMenuKeyboard,
  buildSummaryChannelAddChannelKeyboard,
  buildSummaryChannelChannelsKeyboard,
  buildSummaryChannelDetachChannelsKeyboard,
  buildSummaryChannelMainMenuOnlyKeyboard,
} from './summary-channel.keyboard';
import { UserStateService } from '../../../common/state/user-state.service';
import { UserChannelsService } from '../../core-modules/user-channels/user-channels.service';
import { UserChannelFeature } from '../../core-modules/user-channels/user-channel.entity';
import { ChannelService } from '../../core-modules/channel/channel.service';

@Injectable()
export class SummaryChannelFlow {
  private readonly logger = new Logger(SummaryChannelFlow.name);

  constructor(
    private readonly summaryChannelService: SummaryChannelService,
    private readonly userChannelsService: UserChannelsService,
    private readonly channelService: ChannelService,
    private readonly menuService: MenuService,
    private readonly userStateService: UserStateService,
  ) {}

  private isMessageNotModifiedError(error: any): boolean {
    const desc =
      error?.response?.description ||
      error?.description ||
      error?.message ||
      '';
    return typeof desc === 'string' && desc.includes('message is not modified');
  }

  private async safeEditMessageText(
    ctx: Context,
    text: string,
    extra?: Record<string, any>,
  ) {
    try {
      await ctx.editMessageText(text, extra as any);
    } catch (e: any) {
      if (this.isMessageNotModifiedError(e)) return;
      throw e;
    }
  }

  private async failAddChannelAndExitToMainMenu(
    ctx: Context,
    userId: number,
    message: string,
  ) {
    await this.userStateService.clear(userId);

    const keyboard = buildSummaryChannelMainMenuOnlyKeyboard();

    // это текстовый ответ на ошибку, поэтому достаточно reply
    await ctx.reply(message, { ...keyboard });
  }

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

    if (state.scope !== 'summary-channel') return;
    if (state.step !== 'waiting_for_summary_channel_name') return;

    const channelUsernameWithAt = this.normalizeChannelUsername(text);

    let chat: any;
    try {
      chat = await ctx.telegram.getChat(channelUsernameWithAt as any);
    } catch (e: any) {
      const code = e?.response?.error_code ?? e?.error_code;
      const desc =
        e?.response?.description || e?.description || e?.message || '';

      // Отдельный кейс из практики: бот был кикнут/забанен в канале
      if (
        code === 403 &&
        typeof desc === 'string' &&
        desc.includes('bot was kicked from the channel chat')
      ) {
        await this.failAddChannelAndExitToMainMenu(
          ctx,
          userId,
          `❌ Бот не имеет доступа к каналу ${channelUsernameWithAt}.\n\n` +
            `Похоже, бот был удалён (kicked) из этого канала.\n` +
            `Добавьте бота обратно и попробуйте снова.`,
        );
        return;
      }

      await this.failAddChannelAndExitToMainMenu(
        ctx,
        userId,
        `❌ Не удалось получить информацию о ${channelUsernameWithAt}.\n\n` +
          `Убедитесь, что это реальный публичный канал с @username, и попробуйте снова.`,
      );
      return;
    }

    if (!chat || chat.type !== 'channel') {
      await this.failAddChannelAndExitToMainMenu(
        ctx,
        userId,
        `⚠️ ${channelUsernameWithAt} — это не канал.\n\n` +
          `Пожалуйста, отправьте @username именно публичного канала (chat.type === "channel").`,
      );
      return;
    }

    if (!chat.username) {
      await this.failAddChannelAndExitToMainMenu(
        ctx,
        userId,
        `⚠️ Канал найден, но у него нет @username.\n\n` +
          `В MVP поддерживаются только публичные каналы с @username. Попробуйте другой канал.`,
      );
      return;
    }

    const telegramChatIdNumber = Number(chat.id);
    const telegramChatIdString = String(chat.id);
    const usernameWithoutAt = String(chat.username);

    // A) Channel: upsert
    await this.channelService.upsertChannelFromTelegram({
      telegramChatId: telegramChatIdNumber,
      username: usernameWithoutAt,
      discussionGroupChatId: null,
    });

    // B) UserChannel: upsert/undelete внутри UserChannelsService
    const result =
      await this.userChannelsService.attachChannelToUserFeatureByUsername(
        userId,
        channelUsernameWithAt,
        UserChannelFeature.SUMMARY_CHANNEL,
        false,
      );

    if (result.type === 'channel-not-found') {
      await this.failAddChannelAndExitToMainMenu(
        ctx,
        userId,
        `Канал ${channelUsernameWithAt} не найден в системе.\n\n` +
          `Попробуйте снова.`,
      );
      return;
    }

    if (result.type === 'already-exists') {
      await ctx.reply(
        `Канал ${channelUsernameWithAt} уже подключён к channel-summary.`,
      );
      await this.userStateService.clear(userId);
      await this.showSummaryChannelMenu(ctx);
      return;
    }

    if (result.type === 'added') {
      // MVP UX: сначала success-сообщение, затем список каналов
      await ctx.reply(
        `✅ Канал ${channelUsernameWithAt} подключён к channel-summary, вы будете получать саммари по нему раз в день (в фиксированное время).`,
      );

      await this.userStateService.clear(userId);
      await this.showMyChannels(ctx);

      // Немедленная генерация: business-logic внутри SummaryChannelService
      await this.sendImmediateSummary(ctx, {
        userId,
        channelTelegramChatId: telegramChatIdString,
        channelUsernameWithAt,
        channelUsername: usernameWithoutAt,
      });
      return;
    }

    if (result.type === 'user-not-found') {
      await this.failAddChannelAndExitToMainMenu(
        ctx,
        userId,
        `Пользователь не найден. Пожалуйста, отправьте команду /start и попробуйте снова.`,
      );
      return;
    }

    await this.failAddChannelAndExitToMainMenu(
      ctx,
      userId,
      'Не удалось подключить канал. Попробуйте позже.',
    );
  }

  /**
   * Обработчик всех callback’ов вида "summary-channel:*"
   */
  async handleCallback(ctx: Context, data: string) {
    this.logger.debug(
      `SummaryChannel callback received: "${data}" from user ${ctx.from?.id}`,
    );

    const parts = data.split(':');
    const action = parts[1] as SummaryChannelAction;

    switch (action) {
      case SummaryChannelAction.OpenMenu:
        await this.showSummaryChannelMenu(ctx);
        break;

      case SummaryChannelAction.ListMenu:
        await this.showMyChannels(ctx);
        break;

      case SummaryChannelAction.AddChannelMenu:
        await this.startAddChannel(ctx);
        break;

      case SummaryChannelAction.CancelAddChannelMenu:
        await this.handleCancelAdd(ctx);
        break;

      case SummaryChannelAction.DetachChannelMenu:
        await this.showDetachChannelMenu(ctx);
        break;

      case SummaryChannelAction.DetachChannel:
        await this.handleDetachChannel(ctx, parts[2]);
        break;

      case SummaryChannelAction.BackMenu:
        await this.handleBackToMainMenu(ctx);
        break;

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
        return;
    }

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  private async showSummaryChannelMenu(ctx: Context) {
    const userId = ctx.from?.id;

    let canDetach = false;
    if (userId) {
      const channels =
        await this.userChannelsService.getChannelsForUserByFeature(
          userId,
          UserChannelFeature.SUMMARY_CHANNEL,
        );
      canDetach = channels.length > 0;
    }

    const text = 'Саммари постов канала 📝🎯';
    const keyboard = buildSummaryChannelMenuKeyboard(canDetach);

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async showMyChannels(ctx: Context, notice?: string) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showMyChannels called without userId');
      return;
    }

    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.SUMMARY_CHANNEL,
    );

    const canAdd = channels.length < 1; // MVP-лимит: 1 канал на пользователя

    let text: string;
    if (!channels.length) {
      text = 'У вас пока нет каналов, подключённых к channel-summary.';
    } else {
      text =
        '⚠️ Лимит: можно подключить только 1 канал на пользователя.\n\n' +
        'Ваши каналы для channel-summary:\n\n' +
        channels
          .map((ch) =>
            ch.username ? `• @${ch.username}` : `• ID: ${ch.telegramChatId}`,
          )
          .join('\n');
    }

    if (notice) {
      text = `${notice}\n\n${text}`;
    }

    const keyboard = buildSummaryChannelChannelsKeyboard(canAdd);

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async startAddChannel(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('startAddChannel called without userId');
      return;
    }

    // MVP-лимит: 1 канал на пользователя
    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.SUMMARY_CHANNEL,
    );

    if (channels.length >= 1) {
      // Просто показываем список + только "Назад" (кнопка "Добавить" не нужна)
      await this.showMyChannels(
        ctx,
        '⚠️ Лимит: можно подключить только 1 канал на пользователя.',
      );
      return;
    }

    await this.userStateService.set(userId, {
      scope: 'summary-channel',
      step: 'waiting_for_summary_channel_name',
    });

    const text =
      'Отправьте @username канала, который хотите подключить к channel-summary.\n\n' +
      'Важно: в MVP поддерживаются только публичные каналы с @username.';

    const keyboard = buildSummaryChannelAddChannelKeyboard();

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async handleCancelAdd(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleCancelAdd called without userId');
      return;
    }

    // MVP: состояние сбрасываем только по "Назад" на экране ввода
    await this.userStateService.clear(userId);
    await this.showSummaryChannelMenu(ctx);
  }

  private async showDetachChannelMenu(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showDetachChannelMenu called without userId');
      return;
    }

    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.SUMMARY_CHANNEL,
    );

    if (!channels.length) {
      await this.showSummaryChannelMenu(ctx);
      return;
    }

    const text =
      'Выберите канал который хотите отвязать от функции саммари постов:';
    const keyboard = buildSummaryChannelDetachChannelsKeyboard(channels);

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async handleDetachChannel(ctx: Context, telegramChatIdRaw?: string) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleDetachChannel called without userId');
      return;
    }

    const telegramChatId = Number(telegramChatIdRaw);
    if (!telegramChatIdRaw || Number.isNaN(telegramChatId)) {
      await this.showSummaryChannelMenu(ctx);
      return;
    }

    const result =
      await this.userChannelsService.detachChannelFromUserFeatureByTelegramChatId(
        userId,
        telegramChatId,
        UserChannelFeature.SUMMARY_CHANNEL,
      );

    if (result.type === 'detached') {
      await this.showMyChannels(ctx, '✅ Отвязано. Текущий список каналов:');
      return;
    }

    await this.showSummaryChannelMenu(ctx);
  }

  private async handleBackToMainMenu(ctx: Context) {
    await this.menuService.redrawMainMenu(ctx);
  }

  private normalizeChannelUsername(input: string): string {
    const raw = (input ?? '').trim();
    if (!raw) return raw;
    return raw.startsWith('@') ? raw : `@${raw}`;
  }

  private async sendImmediateSummary(
    ctx: Context,
    params: {
      userId: number;
      channelTelegramChatId: string;
      channelUsernameWithAt: string;
      channelUsername: string;
    },
  ) {
    const res = await this.summaryChannelService.runImmediateSummary(params);

    if (res.type === 'success') {
      for (const msg of res.messages) {
        await ctx.reply(msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        } as any);
      }

      const nextSummaryStr = this.formatDateTime(res.nextSummaryAt);
      await ctx.reply(`Следующее саммари пришлю: ${nextSummaryStr}.`);
      return;
    }

    if (res.type === 'empty') {
      await ctx.reply(res.message);
      return;
    }

    if (res.type === 'limited') {
      await ctx.reply(res.message);
      return;
    }

    await ctx.reply(res.message);
  }

  private formatDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }
}
