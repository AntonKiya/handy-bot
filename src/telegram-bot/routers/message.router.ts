import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { UserStateService } from '../../common/state/user-state.service';
import { SummaryChannelFlow } from '../../modules/feature-modules/summary-channel/summary-channel.flow';
import { ImportantMessagesFlow } from '../../modules/feature-modules/important-messages/important-messages.flow';
import { GroupMessageData } from '../utils/types';
import { UserService } from '../../modules/core-modules/user/user.service';

@Injectable()
export class MessageRouter {
  private readonly logger = new Logger(MessageRouter.name);

  constructor(
    private readonly userStateService: UserStateService,
    private readonly summaryChannelFlow: SummaryChannelFlow,
    private readonly importantMessagesFlow: ImportantMessagesFlow,
    private readonly userService: UserService,
  ) {}

  async route(ctx: Context) {
    const userId = ctx.from?.id;

    if (!userId) {
      return;
    }

    const text = this.extractText(ctx);
    const chatType = ctx.chat?.type;

    // Обработка личных сообщений боту
    if (chatType === 'private') {
      await this.handlePrivateMessage(ctx, userId, text);
      return;
    }

    // Обработка сообщений из групп
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

    if ('text' in ctx.message && typeof ctx.message.text === 'string') {
      return ctx.message.text;
    }

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
    await this.userService.upsertTelegramUser(
      userId,
      ctx.from?.username ?? null,
    );

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
      case 'summary-channel':
        return this.summaryChannelFlow.handleState(ctx, text, state);

      case 'important-messages':
        return this.importantMessagesFlow.handleState(ctx, text, state);

      default:
        this.logger.warn(
          `Unknown state.scope "${state.scope}" for user ${userId}`,
        );
        return;
    }
  }

  /**
   * Обработка сообщений из групп
   * Router → Flow (Flow сам решает что делать)
   */
  private async handleGroupMessage(ctx: Context, userId: number, text: string) {
    const messageData = this.extractMessageData(ctx, userId, text);

    // Передаем в Flow - он сам определит важность через Service
    await this.importantMessagesFlow.handleGroupMessage(ctx, messageData);

    // Обработка ответа на сообщение (для hype)
    if (messageData.isReply && messageData.replyToMessageId) {
      await this.importantMessagesFlow.handleReply(
        ctx,
        messageData.chatId,
        messageData.replyToMessageId,
      );
    }

    this.logger.debug(
      `Group message processed: chatId=${messageData.chatId}, messageId=${messageData.messageId}`,
    );
  }

  /**
   * Извлечение данных из сообщения
   */
  private extractMessageData(
    ctx: Context,
    userId: number,
    text: string,
  ): GroupMessageData {
    const message = ctx.message;
    const chat = ctx.chat as any;

    return {
      chatId: chat.id,
      chatTitle: chat.title || null,
      chatType: chat.type || 'supergroup',
      chatUsername: chat.username || null,
      userId,
      text: text || null,
      messageId: message?.message_id || 0,
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
      hasPhoto: !!(message && 'photo' in message),
      hasVideo: !!(message && 'video' in message),
      hasDocument: !!(message && 'document' in message),
      hasSticker: !!(message && 'sticker' in message),
      hasAudio: !!(message && 'audio' in message),
      hasVoice: !!(message && 'voice' in message),
    };
  }
}
