import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { UserStateService } from '../../common/state/user-state.service';
import { SummaryChannelFlow } from '../../modules/summary-channel/summary-channel.flow';
import { SummaryCommentsFlow } from '../../modules/summary-comments/summary-comments.flow';

@Injectable()
export class MessageRouter {
  private readonly logger = new Logger(MessageRouter.name);

  constructor(
    private readonly userStateService: UserStateService,
    private readonly summaryChannelFlow: SummaryChannelFlow,
    private readonly summaryCommentsFlow: SummaryCommentsFlow,
  ) {}

  async route(ctx: Context) {
    const userId = ctx.from?.id;

    if (!userId) {
      return;
    }

    // Извлекаем текст: либо text (чистый текст), либо caption (текст к медиа)
    const text = this.extractText(ctx);
    const chatType = ctx.chat?.type;

    // Обработка личных сообщений боту (state-based логика)
    if (chatType === 'private') {
      await this.handlePrivateMessage(ctx, userId, text);
      return;
    }

    if (chatType === 'group' || chatType === 'supergroup') {
      await this.handleGroupMessage(ctx, userId, text);
      return;
    }
  }

  /**
   * Извлечение текста из сообщения (text или caption)
   */
  private extractText(ctx: Context): string {
    if (!ctx.message) {
      return '';
    }

    // Проверяем text (обычный текст)
    if ('text' in ctx.message && typeof ctx.message.text === 'string') {
      return ctx.message.text;
    }

    // Проверяем caption (подпись к медиа)
    if ('caption' in ctx.message && typeof ctx.message.caption === 'string') {
      return ctx.message.caption;
    }

    return '';
  }

  /**
   * Обработка личных сообщений боту (state-based flows)
   */
  private async handlePrivateMessage(
    ctx: Context,
    userId: number,
    text: string,
  ) {
    if (!text) {
      this.logger.debug(`No text in private message from user ${userId}`);
      return;
    }

    const state = await this.userStateService.get(userId);

    if (!state) {
      this.logger.debug(
        `No state for user ${userId}. Text: "${text}". Skipping state flows.`,
      );
      return;
    }

    switch (state.scope) {
      case 'summary:channel':
        return this.summaryChannelFlow.handleState(ctx, text, state);

      case 'summary:comments':
        return this.summaryCommentsFlow.handleState(ctx, text, state);

      default:
        this.logger.warn(
          `Unknown state.scope "${state.scope}" for user ${userId}`,
        );
        return;
    }
  }

  /**
   * Обработка сообщений из групп (аггрегатор лидов + категоризация)
   */
  private async handleGroupMessage(ctx: Context, userId: number, text: string) {
    const messageData = this.extractMessageData(ctx, userId, text);

    // Логика передающая управление всем Flow которые должны обрабатывать сообщения (из групп и комментариев)

    this.logger.debug(
      `Group message from user ${userId} in chat ${messageData.chatId}: text="${messageData.text || '(empty)'}"`,
    );
  }

  // TODO: Добавить общий интерфкйс для возвращаемого значения который будет использоваться по всему проекту
  /**
   * Извлечение данных из сообщения в универсальный DTO
   */
  private extractMessageData(ctx: Context, userId: number, text: string) {
    const message = ctx.message;
    const chat = ctx.chat as any;

    return {
      chatId: chat.id,
      chatTitle: chat.title || null,
      userId,
      userName: ctx.from?.first_name || ctx.from?.username || null,
      text: text || null,
      messageId: message?.message_id || null,
      timestamp: new Date(),
      isReply: !!(
        message &&
        'reply_to_message' in message &&
        message.reply_to_message
      ),
      replyToMessageId:
        message && 'reply_to_message' in message
          ? message.reply_to_message?.message_id
          : null,
      // Медиа информация
      hasPhoto: !!(message && 'photo' in message),
      hasVideo: !!(message && 'video' in message),
      hasDocument: !!(message && 'document' in message),
      hasSticker: !!(message && 'sticker' in message),
      hasAudio: !!(message && 'audio' in message),
      hasVoice: !!(message && 'voice' in message),
    };
  }
}
