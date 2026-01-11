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

@Injectable()
export class CoreChannelUsersFlow {
  private readonly logger = new Logger(CoreChannelUsersFlow.name);

  constructor(private readonly menuService: MenuService) {}

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
        await this.showChannelInputInstruction(ctx, period);
        await this.safeAnswerCbQuery(ctx);
        return;
      }

      case CoreChannelUsersAction.Back:
        await this.showPeriodSelectMenu(ctx);
        await this.safeAnswerCbQuery(ctx);
        return;

      case CoreChannelUsersAction.MainMenu:
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
      'Ядро пользователей сообщества\n\n' +
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
  ) {
    // минимальная валидация периода на уровне UI (полная будет позже)
    if (period !== '14d' && period !== '90d') {
      await this.showPeriodSelectMenu(ctx);
      return;
    }

    const periodLabel = getCoreUsersPeriodLabel(period);

    const text =
      `Вы выбрали период: ${periodLabel}.\n\n` +
      `⚠️ Отчёт можно генерировать только 1 раз в 24 часа (на пользователя).\n` +
      `Исключение: если последний запуск завершился со статусом "failed", повторный запуск разрешён сразу.\n\n` +
      `Отправьте @channel_name чтобы продолжить генерацию отчёта (только публичные каналы).`;

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
