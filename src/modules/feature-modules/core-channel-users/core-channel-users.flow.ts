import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { MenuService } from '../../core-modules/menu/menu.service';
import {
  CORE_CHANNEL_USERS_NAMESPACE,
  CoreChannelUsersAction,
  CoreChannelUsersPeriod,
} from './core-channel-users.callbacks';
import {
  buildCoreUsersInputKeyboard,
  buildCoreUsersPeriodKeyboard,
  getCoreUsersPeriodLabel,
} from './core-channel-users.keyboard';
import {
  UserState,
  UserStateService,
} from '../../../common/state/user-state.service';
import { CoreChannelUsersService } from './core-channel-users.service';

@Injectable()
export class CoreChannelUsersFlow {
  private readonly logger = new Logger(CoreChannelUsersFlow.name);

  constructor(
    private readonly menuService: MenuService,
    private readonly userStateService: UserStateService,
    private readonly coreChannelUsersService: CoreChannelUsersService,
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

  private async safeAnswerCbQuery(ctx: Context) {
    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  private normalizeChannelUsername(input: string): string {
    const raw = (input ?? '').trim();
    if (!raw) return raw;
    return raw.startsWith('@') ? raw : `@${raw}`;
  }

  private getPeriodDays(period: CoreChannelUsersPeriod): number | null {
    if (period === '14d') return 14;
    if (period === '90d') return 90;
    return null;
  }

  private async restartWaitingForChannel(
    ctx: Context,
    userId: number,
    period: CoreChannelUsersPeriod,
    message: string,
  ) {
    // текстовый ответ на ошибку → reply ок
    await ctx.reply(message);

    // затем снова показываем инструкцию + ставим state заново (унификация)
    await this.showChannelInputInstruction(ctx, period, userId);
  }

  /**
   * Публичный метод, который вызывается из TextRouter.
   * Flow сам проверяет scope/step и отрабатывает только свой state.
   */
  async handleState(ctx: Context, text: string, state: UserState) {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (state.scope !== 'core-channel-users') return;
    if (state.step !== 'waiting_for_core_channel_users_channel_name') return;

    const period = state.meta?.period as CoreChannelUsersPeriod | undefined;
    const periodDays = period ? this.getPeriodDays(period) : null;

    if (!period || !periodDays) {
      // неконсистентный state → сбрасываем и возвращаем в выбор периода
      await this.userStateService.clear(userId);
      await this.showPeriodSelectMenu(ctx);
      return;
    }

    const channelUsernameWithAt = this.normalizeChannelUsername(text);

    if (!channelUsernameWithAt || !channelUsernameWithAt.startsWith('@')) {
      await this.restartWaitingForChannel(
        ctx,
        userId,
        period,
        '⚠️ Пожалуйста, отправьте @channel_name (например: @my_channel).',
      );
      return;
    }

    // В MVP: состояние закрываем после ввода канала
    await this.userStateService.clear(userId);

    await ctx.reply(
      `⏳ Запускаю формирование отчёта для ${channelUsernameWithAt}. Это может занять немного времени...`,
    );

    const runRes =
      await this.coreChannelUsersService.runImmediateCoreUsersReport({
        userId,
        channelUsernameWithAt,
        period: String(period),
        windowDays: periodDays,
      });

    if (runRes.type === 'limited' || runRes.type === 'already-running') {
      await ctx.reply(runRes.message);
      return;
    }

    if (runRes.type === 'error') {
      // Валидационные ошибки (и любые ошибки до успешного отчёта) — возвращаем в ожидание ввода
      await this.restartWaitingForChannel(ctx, userId, period, runRes.message);
      return;
    }

    const res = runRes.report;
    const periodLabel = getCoreUsersPeriodLabel(period);

    if (res.type === 'no-data' || !res.items.length) {
      await ctx.reply(
        `Топ комментаторов канала ${channelUsernameWithAt} за ${periodLabel}.\n\n` +
          `Нет данных за выбранный период.`,
      );
      return;
    }

    const lines = res.items.map((it) => {
      const uname = it.username ? `@${it.username}` : '(no username)';
      return `${uname} — ${it.commentsCount} комментариев в ${it.postsCount} пост${it.postsCount % 100 === 11 || it.postsCount % 10 !== 1 ? 'ах' : 'у'}`;
    });

    await ctx.reply(
      `Топ комментаторов канала ${channelUsernameWithAt} за ${periodLabel}:\n\n` +
        lines.join('\n'),
    );
  }

  /**
   * Обработчик всех callback "core-users:*"
   */
  async handleCallback(ctx: Context, data: string) {
    const userId = ctx.from?.id;
    this.logger.debug(
      `CoreChannelUsersFlow.handleCallback: data="${data}", user=${userId}`,
    );

    const parts = data.split(':');
    const namespace = parts[0];
    const action = parts[1] as CoreChannelUsersAction;

    if (namespace !== CORE_CHANNEL_USERS_NAMESPACE) {
      await this.safeAnswerCbQuery(ctx);
      return;
    }

    switch (action) {
      case CoreChannelUsersAction.OpenMenu:
        await this.showPeriodSelectMenu(ctx);
        await this.safeAnswerCbQuery(ctx);
        return;

      case CoreChannelUsersAction.SelectPeriod: {
        const period = parts[2] as CoreChannelUsersPeriod;
        await this.showChannelInputInstruction(ctx, period, userId);
        await this.safeAnswerCbQuery(ctx);
        return;
      }

      case CoreChannelUsersAction.Back:
        // MVP: Back закрывает state и возвращает к выбору периода
        if (userId) await this.userStateService.clear(userId);
        await this.showPeriodSelectMenu(ctx);
        await this.safeAnswerCbQuery(ctx);
        return;

      case CoreChannelUsersAction.MainMenu:
        if (userId) await this.userStateService.clear(userId);
        await this.handleBackToMainMenu(ctx);
        await this.safeAnswerCbQuery(ctx);
        return;

      default:
        await this.safeAnswerCbQuery(ctx);
        return;
    }
  }

  private async showPeriodSelectMenu(ctx: Context) {
    const text =
      'Ядро комментаторов 🏆\n\n' +
      'Выберите период, за который нужно сформировать отчёт:';

    const keyboard = buildCoreUsersPeriodKeyboard();

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async showChannelInputInstruction(
    ctx: Context,
    period: CoreChannelUsersPeriod,
    userId?: number,
  ) {
    const periodDays = this.getPeriodDays(period);
    if (!periodDays) {
      await this.showPeriodSelectMenu(ctx);
      return;
    }

    if (userId) {
      await this.userStateService.set(userId, {
        scope: 'core-channel-users',
        step: 'waiting_for_core_channel_users_channel_name',
        meta: { period },
      });
    }

    const periodLabel = getCoreUsersPeriodLabel(period);

    const text =
      `Вы выбрали период: ${periodLabel}.\n\n` +
      `⚠️ Отчёт можно генерировать только 4 раза в 24 часа (на пользователя).\n\n` +
      `Отправьте @channel_name любого публичного канала, чтобы продолжить генерацию отчёта.`;

    const keyboard = buildCoreUsersInputKeyboard();

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async handleBackToMainMenu(ctx: Context) {
    const userId = ctx.from?.id;
    this.logger.debug(
      `CoreChannelUsers: back to main menu requested by user ${userId}`,
    );

    await this.menuService.redrawMainMenu(ctx);
  }
}
