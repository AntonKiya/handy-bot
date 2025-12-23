import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { ReactionCount } from 'telegraf/types';
import { ImportantMessagesService } from './important-messages.service';
import { GroupMessageData } from '../../telegram-bot/utils/types';
import { buildMessageLink } from './utils/link-builder.util';
import { ImportantMessagesAction } from './important-messages.callbacks';
import { UserChannelsService } from '../user-channels/user-channels.service';
import { buildImportantMessagesNotificationKeyboard } from './important-messages.keyboard';
import { ChannelService } from '../channel/channel.service';

@Injectable()
export class ImportantMessagesFlow {
  private readonly logger = new Logger(ImportantMessagesFlow.name);

  constructor(
    private readonly importantMessagesService: ImportantMessagesService,
    private readonly userChannelsService: UserChannelsService,
    private readonly channelService: ChannelService,
  ) {}

  /**
   * Обработка входящего сообщения из группы
   * Вызывается из Router
   */
  async handleGroupMessage(
    ctx: Context,
    messageData: GroupMessageData,
  ): Promise<void> {
    try {
      // Service определяет важность сообщения
      const categories =
        await this.importantMessagesService.processGroupMessage(messageData);

      // Если сообщение не важное - завершаем
      if (!categories || categories.length === 0) {
        return;
      }

      // Если важное - обрабатываем
      await this.handleImportantMessage(ctx, messageData, categories);
    } catch (error) {
      this.logger.error(
        `Error in handleGroupMessage: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Обработка важного сообщения
   * Внутренний метод Flow
   */
  private async handleImportantMessage(
    ctx: Context,
    messageData: GroupMessageData,
    categories: string[],
  ): Promise<void> {
    this.logger.debug(
      `Handling important message ${messageData.messageId} from chat ${messageData.chatId}, categories: ${categories.join(', ')}`,
    );

    // Service сохраняет сообщение
    const savedMessageId =
      await this.importantMessagesService.saveImportantMessage(messageData);

    if (!savedMessageId) {
      return;
    }

    // Отправляем уведомления админам
    await this.sendNotificationToAdmins(
      ctx.telegram,
      savedMessageId,
      messageData,
      categories,
    );

    // Service обновляет время уведомления
    await this.importantMessagesService.updateNotifiedAt(savedMessageId);
  }

  /**
   * Обработка reply на важное сообщение
   * Вызывается из Router
   */
  async handleReply(
    ctx: Context,
    chatId: number,
    replyToMessageId: number,
  ): Promise<void> {
    try {
      // Получаем канал
      const channel =
        await this.channelService.getChannelByTelegramChatId(chatId);

      if (!channel) {
        return;
      }

      // Инкрементим счетчик
      await this.importantMessagesService.incrementRepliesCount(
        channel.id,
        replyToMessageId,
      );

      // Проверяем hype порог
      const shouldNotify =
        await this.importantMessagesService.checkHypeThreshold(
          channel.id,
          replyToMessageId,
        );

      if (shouldNotify) {
        await this.sendHypeNotification(ctx, channel.id, replyToMessageId);
      }
    } catch (error) {
      this.logger.error(`Error handling reply: ${error.message}`, error.stack);
    }
  }

  /**
   * Обработка события message_reaction_count
   * Вызывается из Router
   */
  async handleReactionCount(
    ctx: Context,
    chatId: number,
    messageId: number,
    reactions: ReactionCount[],
  ): Promise<void> {
    try {
      // Получаем канал
      const channel =
        await this.channelService.getChannelByTelegramChatId(chatId);

      if (!channel) {
        return;
      }

      // Подсчитываем общее количество реакций через Service
      const reactionsCount =
        this.importantMessagesService.calculateTotalReactions(reactions);

      // Обновляем reactions_count в БД
      await this.importantMessagesService.updateReactionsCount(
        channel.id,
        messageId,
        reactionsCount,
      );

      // Проверяем hype порог (использует актуальные данные из БД)
      const shouldNotify =
        await this.importantMessagesService.checkHypeThreshold(
          channel.id,
          messageId,
        );

      if (shouldNotify) {
        await this.sendHypeNotification(ctx, channel.id, messageId);
      }
    } catch (error) {
      this.logger.error(
        `Error handling reaction count: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Отправка hype уведомления
   * Приватный метод
   */
  private async sendHypeNotification(
    ctx: Context,
    channelId: string,
    telegramMessageId: number,
  ): Promise<void> {
    const message = await this.importantMessagesService.getMessageByTelegramId(
      channelId,
      telegramMessageId,
    );

    if (!message) {
      return;
    }

    this.logger.log(
      `Sending hype notification for message ${telegramMessageId} in channel ${channelId}`,
    );

    // Формируем messageData
    const messageData: GroupMessageData = {
      chatId: message.channel.telegram_chat_id,
      chatTitle: null,
      chatType: 'supergroup',
      chatUsername: message.channel.username,
      userId: message.telegram_user_id,
      text: message.text,
      messageId: message.telegram_message_id,
      timestamp: message.created_at,
      isReply: false,
      replyToMessageId: null,
      hasPhoto: false,
      hasVideo: false,
      hasDocument: false,
      hasSticker: false,
      hasAudio: false,
      hasVoice: false,
    };

    // Отправляем уведомление с категорией 'hype'
    await this.sendNotificationToAdmins(ctx.telegram, message.id, messageData, [
      'hype',
    ]);

    // Обновляем hype_notified_at
    await this.importantMessagesService.updateHypeNotifiedAt(
      channelId,
      telegramMessageId,
    );
  }

  /**
   * Отправка уведомлений админам
   * Единый текст для всех категорий
   */
  private async sendNotificationToAdmins(
    telegram: Context['telegram'],
    messageId: string,
    messageData: GroupMessageData,
    categories: string[],
  ): Promise<void> {
    const adminIds =
      await this.userChannelsService.getChannelAdminsByTelegramChatId(
        messageData.chatId,
      );

    if (adminIds.length === 0) {
      this.logger.warn(
        `No admins found for channel ${messageData.chatId}, notifications not sent`,
      );
      return;
    }

    // Формируем текст и кнопки
    const text = this.buildNotificationText(messageData, categories);

    const keyboard = buildImportantMessagesNotificationKeyboard(
      buildMessageLink(
        messageData.chatId,
        messageData.messageId,
        messageData.chatType,
        messageData.chatUsername,
      ),
      messageId,
    );

    // Отправляем каждому админу
    for (const adminId of adminIds) {
      try {
        await telegram.sendMessage(adminId, text, keyboard);

        this.logger.debug(
          `Notification sent to admin ${adminId} for message ${messageId}`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to send notification to admin ${adminId}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Формирование текста уведомления
   */
  private buildNotificationText(
    messageData: GroupMessageData,
    categories: string[],
  ): string {
    const channelName = messageData.chatTitle || `ID: ${messageData.chatId}`;
    const categoriesTags = categories.map((c) => `#${c}`).join(' ');
    const preview = messageData.text
      ? messageData.text.length > 100
        ? messageData.text.substring(0, 100) + '...'
        : messageData.text
      : '(нет текста)';

    return `📩 Важное сообщение в канале "${channelName}"\n\nКатегории: ${categoriesTags}\n\n${preview}`;
  }

  /**
   * Обработка callback от кнопок
   */
  async handleCallback(ctx: Context, data: string): Promise<void> {
    const parts = data.split(':');
    const action = parts[1] as ImportantMessagesAction;

    switch (action) {
      case ImportantMessagesAction.Done:
        return this.handleDoneAction(ctx);

      default:
        if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
          await ctx.answerCbQuery();
        }
    }
  }

  /**
   * Обработка нажатия кнопки "Готово"
   */
  private async handleDoneAction(ctx: Context): Promise<void> {
    try {
      if ('deleteMessage' in ctx && typeof ctx.deleteMessage === 'function') {
        await ctx.deleteMessage();
      }

      if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
        await ctx.answerCbQuery('✅ Готово');
      }
    } catch (error) {
      this.logger.error(
        `Error handling done action: ${error.message}`,
        error.stack,
      );

      if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
        await ctx.answerCbQuery('Ошибка');
      }
    }
  }
}
