import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramBotService } from '../../telegram-bot/telegram-bot.service';
import { Context } from 'telegraf';
import { Message } from 'telegraf/types';

export interface MessageMetadata {
  source: 'bot-api' | 'core-api';
  type: 'group_message' | 'channel_post' | 'channel_comment';
  chatId: string;
  chatTitle: string;
  messageId: number;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date;
  isReply: boolean;
  replyToMessageId?: number;
}

@Injectable()
export class BotListenerService implements OnModuleInit {
  private readonly logger = new Logger(BotListenerService.name);

  // Дедупликация сообщений
  private processedMessages = new Set<string>();

  // Метрики
  private messageStats = {
    groupMessages: 0,
    channelPosts: 0,
    channelComments: 0,
  };

  constructor(private readonly telegramBot: TelegramBotService) {}

  async onModuleInit() {
    this.telegramBot.registerGroupMessageHandler((ctx) =>
      this.handleMessage(ctx),
    );
    this.telegramBot.registerChannelPostHandler((ctx) =>
      this.handleChannelPost(ctx),
    );

    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log('🤖 Bot API Listener initialized');
    this.logger.log('📝 Ready to receive events where bot is admin');
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * Проверка дедупликации
   */
  private isMessageProcessed(chatId: string, messageId: number): boolean {
    const key = `bot-${chatId}:${messageId}`;

    if (this.processedMessages.has(key)) {
      return true;
    }

    this.processedMessages.add(key);

    setTimeout(() => {
      this.processedMessages.delete(key);
    }, 60000);

    return false;
  }

  /**
   * Универсальный обработчик сообщений (группы + комментарии)
   */
  private handleMessage(ctx: Context) {
    const chatType = ctx.chat?.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      const message = ctx.message as Message.TextMessage;

      // Дедупликация
      if (this.isMessageProcessed(ctx.chat.id.toString(), message.message_id)) {
        return;
      }

      if (
        message &&
        'reply_to_message' in message &&
        message.reply_to_message
      ) {
        this.handleChannelComment(ctx);
      } else {
        this.handleGroupMessage(ctx);
      }
    }
  }

  /**
   * Обработка сообщений из групп (где бот админ)
   */
  private handleGroupMessage(ctx: Context) {
    const chatType = ctx.chat?.type;

    if (chatType !== 'group' && chatType !== 'supergroup') {
      return;
    }

    const chat = ctx.chat as { id: number; title?: string; type: string };
    const message = ctx.message as Message.TextMessage & {
      reply_to_message?: Message;
    };

    this.messageStats.groupMessages++;

    const metadata: MessageMetadata = {
      source: 'bot-api',
      type: 'group_message',
      chatId: chat.id.toString(),
      chatTitle: chat.title || 'Unknown Group',
      messageId: message.message_id,
      senderId: ctx.from?.id?.toString() || 'unknown',
      senderName: ctx.from?.first_name || ctx.from?.username || 'Unknown User',
      text: 'text' in message ? message.text : '[No text]',
      timestamp: new Date(),
      isReply: !!message.reply_to_message,
      replyToMessageId: message.reply_to_message?.message_id,
    };

    this.logMessage(metadata, '1️⃣ BOT ADMIN → GROUP MESSAGE');
  }

  /**
   * Обработка постов в каналах (где бот админ)
   */
  private handleChannelPost(ctx: Context) {
    if (!ctx.channelPost) return;

    const chat = ctx.chat as { id: number; title?: string; type: string };
    const channelPost = ctx.channelPost as Message.TextMessage;

    // Дедупликация
    if (this.isMessageProcessed(chat.id.toString(), channelPost.message_id)) {
      return;
    }

    this.messageStats.channelPosts++;

    const metadata: MessageMetadata = {
      source: 'bot-api',
      type: 'channel_post',
      chatId: chat.id.toString(),
      chatTitle: chat.title || 'Unknown Channel',
      messageId: channelPost.message_id,
      senderId: 'channel',
      senderName: chat.title || 'Channel',
      text: 'text' in channelPost ? channelPost.text : '[No text]',
      timestamp: new Date(),
      isReply: false,
    };

    this.logMessage(metadata, '2️⃣ BOT ADMIN → CHANNEL POST');
  }

  /**
   * Обработка комментариев к постам канала (где бот админ в discussion group)
   */
  private handleChannelComment(ctx: Context) {
    const chatType = ctx.chat?.type;

    if (chatType !== 'group' && chatType !== 'supergroup') {
      return;
    }

    const chat = ctx.chat as { id: number; title?: string; type: string };
    const message = ctx.message as Message.TextMessage & {
      reply_to_message?: Message;
    };

    if (!message.reply_to_message) {
      return;
    }

    this.messageStats.channelComments++;

    const metadata: MessageMetadata = {
      source: 'bot-api',
      type: 'channel_comment',
      chatId: chat.id.toString(),
      chatTitle: chat.title || 'Unknown Discussion Group',
      messageId: message.message_id,
      senderId: ctx.from?.id?.toString() || 'unknown',
      senderName: ctx.from?.first_name || ctx.from?.username || 'Unknown User',
      text: 'text' in message ? message.text : '[No text]',
      timestamp: new Date(),
      isReply: true,
      replyToMessageId: message.reply_to_message.message_id,
    };

    this.logMessage(metadata, '3️⃣ BOT ADMIN → CHANNEL COMMENT');
  }

  private logMessage(metadata: MessageMetadata, header: string) {
    this.logger.log('');
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log(header);
    this.logger.log(`📍 Chat: ${metadata.chatTitle}`);
    this.logger.log(`👤 From: ${metadata.senderName}`);
    this.logger.log(`💬 Text: ${metadata.text}`);
    this.logger.log(`🕐 Time: ${metadata.timestamp.toISOString()}`);
    if (metadata.isReply) {
      this.logger.log(`↩️  Reply to message: ${metadata.replyToMessageId}`);
    }
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Периодически показываем статистику
    const total =
      this.messageStats.groupMessages +
      this.messageStats.channelPosts +
      this.messageStats.channelComments;
    if (total % 10 === 0) {
      this.logger.log('📊 Stats: ' + JSON.stringify(this.messageStats));
    }
  }
}
