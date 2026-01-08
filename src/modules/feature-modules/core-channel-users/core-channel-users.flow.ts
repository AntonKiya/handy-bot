import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { MenuService } from '../../core-modules/menu/menu.service';
import { UserChannelsService } from '../../core-modules/user-channels/user-channels.service';
import {
  CORE_CHANNEL_USERS_NAMESPACE,
  CoreChannelUsersAction,
} from './core-channel-users.callbacks';
import { CoreChannelUsersService } from './core-channel-users.service';

@Injectable()
export class CoreChannelUsersFlow {
  private readonly logger = new Logger(CoreChannelUsersFlow.name);

  constructor(
    private readonly menuService: MenuService,
    private readonly userChannelsService: UserChannelsService,
    private readonly coreChannelUsersService: CoreChannelUsersService,
  ) {}

  /**
   * Обработчик всех callback "core-users:*"
   */
  async handleCallback(ctx: Context, data: string) {
    const userId = ctx.from?.id;
    this.logger.debug(
      `CoreChannelUsersFlow.handleCallback: data="${data}", user=${userId}`,
    );

    const parts = data.split(':');
    const action = parts[1] as CoreChannelUsersAction;

    switch (action) {
      case CoreChannelUsersAction.OpenMenu:
        return this.showChannelSelectMenu(ctx);

      case CoreChannelUsersAction.SelectChannelMenu: {
        const channelId = parts[2];
        return this.handleChannelSelected(ctx, channelId);
      }

      case CoreChannelUsersAction.BackMenu:
        return this.handleBackToMainMenu(ctx);

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
    }
  }

  /**
   * Экран выбора канала для отчёта по ядру.
   */
  private async showChannelSelectMenu(ctx: Context) {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      this.logger.warn('showChannelSelectMenu called without telegramUserId');
      return;
    }

    this.logger.debug(
      `CoreChannelUsers: showChannelSelectMenu for user ${telegramUserId}`,
    );

    const channels =
      await this.userChannelsService.getChannelsForUser(telegramUserId);

    let text: string;
    let keyboard;

    if (!channels.length) {
      text =
        'У вас пока нет подключённых каналов.\n\n' +
        'Добавьте бота как администратора в канал, чтобы он появился в списке.';

      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '⬅ Назад',
            `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.BackMenu}`,
          ),
        ],
      ]);
    } else {
      text =
        'Выберите канал, для которого нужно сформировать отчёт по ядру комментаторов:\n\n' +
        channels
          .map((ch) => {
            const displayName = ch.username
              ? `@${ch.username}`
              : `ID: ${ch.telegramChatId}`;
            return `• ${displayName}`;
          })
          .join('\n');

      const buttons = channels.map((ch) => {
        const displayName = ch.username
          ? `@${ch.username}`
          : `ID: ${ch.telegramChatId}`;
        return [
          Markup.button.callback(
            displayName,
            `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.SelectChannelMenu}:${ch.telegramChatId}`,
          ),
        ];
      });

      buttons.push([
        Markup.button.callback(
          '⬅ Назад',
          `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.BackMenu}`,
        ),
      ]);

      keyboard = Markup.inlineKeyboard(buttons);
    }

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
   * Пользователь выбрал конкретный канал.
   * 1) Показываем, что обработка запущена.
   * 2) Строим отчёт и шлём отдельным сообщением.
   */
  private async handleChannelSelected(ctx: Context, channelIdRaw: string) {
    const telegramUserId = ctx.from?.id;
    this.logger.debug(
      `CoreChannelUsers: handleChannelSelected channelId=${channelIdRaw} by user=${telegramUserId}`,
    );

    const channelIdNum = Number(channelIdRaw);
    if (!Number.isFinite(channelIdNum)) {
      this.logger.warn(
        `CoreChannelUsers: invalid channelId "${channelIdRaw}" received`,
      );
      return;
    }

    const processingText =
      'Обработка данных по ядру комментаторов для выбранного канала запущена.\n\n' +
      'Отчёт будет отправлен отдельным сообщением.';

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await ctx.editMessageText(processingText);

      if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
        await ctx.answerCbQuery();
      }
    } else {
      await ctx.reply(processingText);
    }

    // 2) Строим отчёт и шлём результат
    try {
      const report =
        await this.coreChannelUsersService.buildCoreUsersReportForChannel(
          channelIdNum,
        );

      if (report.type === 'no-data') {
        const noDataText =
          'Пока нет достаточно данных по комментариям за выбранный период.\n\n' +
          `Окно анализа: с ${report.windowFrom.toLocaleDateString()} по ${report.windowTo.toLocaleDateString()}.`;

        await ctx.reply(noDataText);
        return;
      }

      const { items, windowFrom, windowTo, syncedWithTelegram } = report;

      const headerLines: string[] = [];

      headerLines.push(
        `Ядро комментаторов за период с ${windowFrom.toLocaleDateString()} по ${windowTo.toLocaleDateString()}.`,
      );

      if (syncedWithTelegram) {
        headerLines.push('Данные только что обновлены по последним постам.');
      } else {
        headerLines.push(
          'Показаны данные из последней синхронизации (лимит по частоте синка).',
        );
      }

      headerLines.push('');
      headerLines.push('Топ комментаторов (по числу комментариев):');
      headerLines.push('');

      const lines: string[] = [];

      items.forEach((item, idx) => {
        const avg = item.avgCommentsPerActivePost.toFixed(2);

        // Отображаем username если есть, иначе ID
        // TODO: Учесть возможное изменение имени.
        // Если пользователь изменит свой username в Telegram после последней синхронизации,
        // в отчёте будет отображаться старый username до следующей синхронизации комментариев этого пользователя.
        // Также если username был удалён пользователем, мы продолжим показывать старый username.
        const userLabel = item.username
          ? `@${item.username}`
          : `ID: ${item.telegramUserId}`;

        lines.push(
          `${idx + 1}. ${userLabel} — ${item.commentsCount} комментариев ` +
            `(в ${item.postsCount} постах, в среднем ${avg} комментария на пост, где этот пользователь был активен).`,
        );
      });

      const messageText = [...headerLines, ...lines].join('\n');

      await ctx.reply(messageText);
    } catch (e) {
      this.logger.error(
        `CoreChannelUsers: failed to build report for channelId=${channelIdRaw}`,
        e as any,
      );

      await ctx.reply(
        'Не удалось сформировать отчёт по ядру комментаторов. Попробуйте позже.',
      );
    }
  }

  /**
   * Назад в главное меню
   */
  private async handleBackToMainMenu(ctx: Context) {
    const userId = ctx.from?.id;
    this.logger.debug(
      `CoreChannelUsers: back to main menu requested by user ${userId}`,
    );

    await this.menuService.redrawMainMenu(ctx);

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }
}
