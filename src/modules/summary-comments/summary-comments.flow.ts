import { Injectable, Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { UserState } from '../../common/state/user-state.service';
import {
  SummaryCommentsService,
  SummaryCommentsStateResult,
} from './summary-comments.service';
import { MenuService } from '../menu/menu.service';
import { SummaryCommentsAction } from './summary-comments.callbacks';
import { ParsedComment } from './summary-comments.service';

@Injectable()
export class SummaryCommentsFlow {
  private readonly logger = new Logger(SummaryCommentsFlow.name);

  constructor(
    private readonly summaryCommentsService: SummaryCommentsService,
    private readonly menuService: MenuService,
  ) {}

  /**
   * Обработка текста при активном стейте summary:comments
   */
  async handleState(ctx: Context, text: string, state: UserState) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('SummaryCommentsFlow.handleState called without userId');
      return;
    }

    this.logger.debug(
      `SummaryCommentsFlow.handleState for user ${userId}, step: ${state.step}, text: "${text}"`,
    );

    const result: SummaryCommentsStateResult =
      await this.summaryCommentsService.handleState(userId, text, state);

    if (result.type === 'comments-fetched') {
      await this.showComments(ctx, result.channel, result.comments);
      return;
    }
  }

  /**
   * Обработка всех callback'ов summary:comments:*
   */
  async handleCallback(ctx: Context, data: string) {
    this.logger.debug(
      `SummaryComments callback received: "${data}" from user ${ctx.from?.id}`,
    );

    const parts = data.split(':'); // ['summary', 'comments', 'add-new' | 'cancel-add']
    const action = parts[2] as SummaryCommentsAction;

    switch (action) {
      case SummaryCommentsAction.AddNew:
        return this.handleAddChannel(ctx);

      case SummaryCommentsAction.CancelAdd:
        return this.handleCancelAdd(ctx);

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
    }
  }

  private async handleAddChannel(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleAddChannel called without userId');
      return;
    }

    this.logger.debug(
      `SummaryComments: add channel requested by user ${userId}`,
    );

    const { message } =
      await this.summaryCommentsService.startAddChannelForComments(userId);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅ Назад', 'summary:comments:cancel-add')],
    ]);

    await ctx.editMessageText(message, {
      ...keyboard,
    });

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
      `SummaryComments: cancel add channel requested by user ${userId}`,
    );

    await this.summaryCommentsService.cancelAddChannel(userId);

    // Возвращаем пользователя в главное меню
    await this.menuService.redrawMainMenu(ctx);

    if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery();
    }
  }

  async showComments(
    ctx: Context,
    channelNameWithAt: string,
    comments: ParsedComment[],
  ): Promise<void> {
    const channel = channelNameWithAt.startsWith('@')
      ? channelNameWithAt
      : `@${channelNameWithAt}`;

    if (!comments.length) {
      await ctx.reply(
        `Комментариев в последних 3 постах канала ${channel} не найдено.`,
      );
      return;
    }

    const header = `Комментарии из последних 3 постов канала ${channel}:\n\n`;

    const lines = comments.map((c, idx) => {
      // Первые 10 слов для превью
      const words = c.text.split(/\s+/).filter(Boolean);
      const preview = words.slice(0, 10).join(' ');
      const suffix = words.length > 10 ? '…' : '';

      return `${idx + 1}. [post ${c.postId}] ${preview}${suffix}`;
    });

    const messageText = header + lines.join('\n');

    await ctx.reply(messageText);
  }
}
