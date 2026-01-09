import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import {
  SummaryChannelService,
  SummaryChannelStateResult,
} from './summary-channel.service';
import { UserState } from '../../../common/state/user-state.service';
import { SummaryChannelAction } from './summary-channel.callbacks';
import { MenuService } from '../../core-modules/menu/menu.service';
import {
  buildSummaryChannelMenuKeyboard,
  buildSummaryChannelAddChannelKeyboard,
  buildSummaryChannelChannelsKeyboard,
  buildSummaryChannelDetachChannelsKeyboard,
} from './summary-channel.keyboard';
import { UserStateService } from '../../../common/state/user-state.service';

@Injectable()
export class SummaryChannelFlow {
  private readonly logger = new Logger(SummaryChannelFlow.name);

  constructor(
    private readonly summaryChannelService: SummaryChannelService,
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
      // Нормальная ситуация в Telegram: попытались отредактировать тем же самым текстом/клавиатурой.
      if (this.isMessageNotModifiedError(e)) {
        return;
      }
      throw e;
    }
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

    if (state.scope !== 'summary-channel') {
      return;
    }

    if (state.step !== 'waiting_for_summary_channel_name') {
      return;
    }

    this.logger.debug(
      `SummaryChannelFlow.handleState for user ${userId}, step: ${state.step}, text: "${text}"`,
    );

    const result: SummaryChannelStateResult =
      await this.summaryChannelService.handleState(userId, text, state);

    if (result.type === 'channel-added') {
      // MVP UX: сначала success-сообщение, затем список каналов
      await ctx.reply(
        `✅ Канал ${result.newChannel} подключён к channel-summary, вы будете получать саммари по нему раз в день (в фиксированное время).`,
      );

      await this.showMyChannels(ctx);

      // Текущая логика немедленного саммари остаётся как есть (будем приводить к ТЗ далее)
      await this.sendChannelSummaries(ctx, result.newChannel);
      return;
    }
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
      const channels = this.summaryChannelService.getChannelsForUser(userId);
      canDetach = channels.length > 0;
    }

    const text = 'Саммари постов канала — меню';
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

    const channels = this.summaryChannelService.getChannelsForUser(userId);
    const canAdd = channels.length < 1; // UI-поведение как в important-messages (реальный enforce — шаг 2)

    let text: string;
    if (!channels.length) {
      text = 'У вас пока нет каналов, подключённых к channel-summary.';
    } else {
      text =
        '⚠️ Лимит: можно подключить только 1 канал на пользователя.\n\n' +
        'Ваши каналы для channel-summary:\n\n' +
        channels.map((c) => `• ${this.normalizeChannelUsername(c)}`).join('\n');
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

    // UI-лимит (реальный enforce — шаг 2)
    const channels = this.summaryChannelService.getChannelsForUser(userId);
    if (channels.length >= 1) {
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
    await this.summaryChannelService.cancelAddChannel(userId);
    await this.showSummaryChannelMenu(ctx);
  }

  private async showDetachChannelMenu(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showDetachChannelMenu called without userId');
      return;
    }

    const channels = this.summaryChannelService.getChannelsForUser(userId);
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

  private async handleDetachChannel(ctx: Context, usernameRaw?: string) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleDetachChannel called without userId');
      return;
    }

    const raw = (usernameRaw ?? '').trim();
    if (!raw) {
      await this.showSummaryChannelMenu(ctx);
      return;
    }

    const channelUsernameWithAt = this.normalizeChannelUsername(raw);

    const result = this.summaryChannelService.detachChannel(
      userId,
      channelUsernameWithAt,
    );

    if (result.type === 'detached') {
      await this.showMyChannels(ctx, '✅ Отвязано. Текущий список каналов:');
      return;
    }

    // Если не нашли — просто вернём в меню
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
