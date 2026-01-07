import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';
import { ReactionType } from 'telegraf/types';
import { ImportantMessagesService } from './important-messages.service';
import { GroupMessageData } from '../../../telegram-bot/utils/types';
import { buildMessageLink, buildCommentLink } from './utils/link-builder.util';
import { ImportantMessagesAction } from './important-messages.callbacks';
import { UserChannelsService } from '../../core-modules/user-channels/user-channels.service';
import {
  buildImportantMessagesNotificationKeyboard,
  buildImportantMessagesMenuKeyboard,
  buildImportantMessagesAddChannelKeyboard,
} from './important-messages.keyboard';
import { ChannelService } from '../../core-modules/channel/channel.service';
import { UserChannelFeature } from '../../core-modules/user-channels/user-channel.entity';
import { MenuService } from '../../core-modules/menu/menu.service';
import {
  UserState,
  UserStateService,
} from '../../../common/state/user-state.service';
import { TelegramAccessVerifierService } from '../../core-modules/telegram-access/telegram-access-verifier.service';

@Injectable()
export class ImportantMessagesFlow {
  private readonly logger = new Logger(ImportantMessagesFlow.name);

  constructor(
    private readonly importantMessagesService: ImportantMessagesService,
    private readonly userChannelsService: UserChannelsService,
    private readonly channelService: ChannelService,
    private readonly menuService: MenuService,
    private readonly userStateService: UserStateService,
    private readonly telegramAccessVerifier: TelegramAccessVerifierService,
  ) {}

  /**
   * Публичный метод, который вызывается из TextRouter.
   * Flow сам не меняет state и не выполняет бизнес-логику —
   * он просто делегирует работу доменному сервису.
   */
  async handleState(ctx: Context, text: string, state: UserState) {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      this.logger.warn('handleState called without telegramUserId');
      return;
    }

    if (state.scope !== 'important-messages') {
      return;
    }

    if (state.step !== 'waiting_for_important_messages_channel_name') {
      return;
    }

    const channelUsernameWithAt = this.normalizeChannelUsername(text);

    const resolved = await this.telegramAccessVerifier.resolveChannelByUsername(
      ctx.telegram,
      channelUsernameWithAt,
    );

    if (!resolved.ok) {
      await ctx.reply(
        `Канал ${channelUsernameWithAt} не найден в Telegram или бот не имеет доступа.\n\n` +
          `Добавьте бота как администратора в этот канал и убедитесь, что у канала есть дискуссионная группа.\n` +
          `Затем попробуйте снова.`,
      );
      return;
    }

    const channelChatId = resolved.channelChatId;

    const botAdminInChannel =
      await this.telegramAccessVerifier.verifyBotIsAdminInChannel(
        ctx.telegram,
        channelChatId,
      );

    if (!botAdminInChannel.ok) {
      await ctx.reply(
        `❌ Бот не является администратором в канале ${channelUsernameWithAt}.\n\n` +
          `Добавьте бота администратором в канал и попробуйте снова.`,
      );
      return;
    }

    const hasDiscussionGroup =
      this.telegramAccessVerifier.verifyChannelHasDiscussionGroup(
        resolved.discussionGroupChatId,
      );

    if (!hasDiscussionGroup.ok) {
      await ctx.reply(
        `❌ У канала ${channelUsernameWithAt} не подключена дискуссионная группа.\n\n` +
          `Включите обсуждения (discussion group) и попробуйте снова.`,
      );
      return;
    }

    const discussionGroupChatId = Number(resolved.discussionGroupChatId);

    const botAdminInDiscussionGroup =
      await this.telegramAccessVerifier.verifyBotIsAdminInDiscussionGroup(
        ctx.telegram,
        discussionGroupChatId,
      );

    if (!botAdminInDiscussionGroup.ok) {
      await ctx.reply(
        `❌ Бот не является администратором в дискуссионной группе канала ${channelUsernameWithAt}.\n\n` +
          `Добавьте бота администратором в дискуссионную группу и попробуйте снова.`,
      );
      return;
    }

    const userAdminInChannel =
      await this.telegramAccessVerifier.verifyUserIsAdminInChannel(
        ctx.telegram,
        channelChatId,
        telegramUserId,
      );

    if (!userAdminInChannel.ok) {
      await ctx.reply(
        `❌ Подключить канал может только администратор.\n\n` +
          `Похоже, вы не являетесь администратором канала ${channelUsernameWithAt}.`,
      );
      return;
    }

    // Сценарий A: после всех проверок сохраняем/обновляем канал в БД
    await this.channelService.upsertChannelFromTelegram({
      telegramChatId: channelChatId,
      username: resolved.username,
      discussionGroupChatId: resolved.discussionGroupChatId,
    });

    const result =
      await this.userChannelsService.attachChannelToUserFeatureByUsername(
        telegramUserId,
        channelUsernameWithAt,
        UserChannelFeature.IMPORTANT_MESSAGES,
        userAdminInChannel.ok,
      );

    if (result.type === 'channel-not-found') {
      await ctx.reply(
        `Канал ${channelUsernameWithAt} не найден в системе.\n\n` +
          `Добавьте бота как администратора в этот канал и убедитесь, что у канала есть дискуссионная группа.\n` +
          `Затем попробуйте снова.`,
      );
      return;
    }

    if (result.type === 'already-exists') {
      await ctx.reply(
        `Канал ${channelUsernameWithAt} уже подключён к important-messages.`,
      );
      await this.userStateService.clear(telegramUserId);
      await this.showImportantMessagesMenu(ctx);
      return;
    }

    if (result.type === 'added') {
      await ctx.reply(
        `✅ Канал ${channelUsernameWithAt} подключён к important-messages.`,
      );
      await this.userStateService.clear(telegramUserId);
      await this.showImportantMessagesMenu(ctx);
      return;
    }

    if (result.type === 'user-not-found') {
      await ctx.reply(
        `Пользователь не найден. Пожалуйста, отправьте команду /start и попробуйте снова.`,
      );
      return;
    }

    await ctx.reply('Не удалось подключить канал. Попробуйте позже.');
  }

  /**
   * Обработка входящего сообщения из группы
   * Вызывается из Router
   */
  async handleGroupMessage(
    ctx: Context,
    messageData: GroupMessageData,
  ): Promise<void> {
    try {
      // Service сохраняет сообщение
      const savedMessageId =
        await this.importantMessagesService.saveImportantMessage(
          messageData,
          ctx,
        );

      if (!savedMessageId) {
        return;
      }

      // Service определяет важность сообщения
      const categories =
        await this.importantMessagesService.processGroupMessage(messageData);

      // Если сообщение не важное - завершаем
      if (!categories || categories.length === 0) {
        return;
      }

      // Если важное - обрабатываем
      await this.handleImportantMessage(
        ctx,
        messageData,
        categories,
        savedMessageId,
      );
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
    savedMessageId: string,
  ): Promise<void> {
    this.logger.debug(
      `Handling important message ${messageData.messageId} from chat ${messageData.chatId}, categories: ${categories.join(', ')}`,
    );

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

  // TODO: сейчас сюда приходит и сам пост и комментарии админа, такого быть не должно
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

      if (!channel) return;

      // Проверяем существует ли запись
      const message =
        await this.importantMessagesService.getMessageByTelegramId(
          channel.id,
          replyToMessageId,
        );

      // Если записи нет - создаем (это пост, на который отвечают)
      if (!message) {
        await this.importantMessagesService.saveMessageForHypeTracking(
          channel.id,
          replyToMessageId,
          ctx,
        );
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

  // TODO: сейчас сюда приходит и сам пост и комментарии админа, такого быть не должно
  /**
   * Обработка события message_reaction_count
   * Вызывается из Router
   */
  async handleReactionCount(
    ctx: Context,
    chatId: number,
    messageId: number,
    oldReaction: ReactionType[],
    newReaction: ReactionType[],
  ): Promise<void> {
    try {
      // Получаем канал
      const channel =
        await this.channelService.getChannelByTelegramChatId(chatId);

      if (!channel) return;

      // Проверяем существует ли запись
      const message =
        await this.importantMessagesService.getMessageByTelegramId(
          channel.id,
          messageId,
        );

      // Если записи нет - создаем
      if (!message) {
        await this.importantMessagesService.saveMessageForHypeTracking(
          channel.id,
          messageId,
          ctx,
        );
      }

      // Подсчитываем общее количество реакций через Service
      const reactionsCount =
        await this.importantMessagesService.calculateTotalReactions(
          channel.id,
          messageId,
          oldReaction,
          newReaction,
        );

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
    const message = await this.importantMessagesService.getById(messageId);

    if (!message) {
      return;
    }

    const channel = message.channel;

    const postMessageId = message.post_message_id;
    const channelUsername = channel.username;

    const adminIds =
      await this.userChannelsService.getChannelAdminsByTelegramChatIdAndFeature(
        channel.telegram_chat_id,
        UserChannelFeature.IMPORTANT_MESSAGES,
      );

    if (adminIds.length === 0) {
      this.logger.warn(
        `No admins found for channel ${messageData.chatId}, notifications not sent`,
      );
      return;
    }

    // Формируем текст и кнопки
    const text = this.buildNotificationText(messageData, categories);

    let messageLink: string;
    if (channelUsername && postMessageId) {
      messageLink = buildCommentLink(
        channelUsername,
        postMessageId,
        messageData.messageId,
      );
    } else {
      // Формируем ссылку с fallback
      messageLink = buildMessageLink(
        channel.discussion_group_id,
        messageData.messageId,
        messageData.chatType,
        messageData.chatUsername,
      );
    }

    this.logger.debug(`Generated link: ${messageLink}`);

    const keyboard = buildImportantMessagesNotificationKeyboard(
      messageLink,
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
      case ImportantMessagesAction.DoneAlert:
        return this.handleDoneAction(ctx);

      case ImportantMessagesAction.OpenMenu:
        await this.showImportantMessagesMenu(ctx);
        break;

      case ImportantMessagesAction.ListMenu:
        await this.showMyChannels(ctx);
        break;

      case ImportantMessagesAction.AddChannelMenu:
        await this.startAddChannel(ctx);
        break;

      case ImportantMessagesAction.CancelAddChannelMenu:
        await this.handleCancelAddChannel(ctx);
        break;

      case ImportantMessagesAction.BackMenu:
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

  private async showImportantMessagesMenu(ctx: Context) {
    const text = 'Важные сообщения — меню';

    const keyboard = buildImportantMessagesMenuKeyboard();

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await ctx.editMessageText(text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async showMyChannels(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showMyChannels called without userId');
      return;
    }

    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.IMPORTANT_MESSAGES,
    );

    let text: string;
    if (!channels.length) {
      text = 'У вас пока нет каналов, подключённых к important-messages.';
    } else {
      text =
        'Ваши каналы для important-messages:\n\n' +
        channels
          .map((ch) =>
            ch.username ? `• @${ch.username}` : `• ID: ${ch.telegramChatId}`,
          )
          .join('\n');
    }

    const keyboard = buildImportantMessagesMenuKeyboard();

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await ctx.editMessageText(text, { ...keyboard });
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

    const existing = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.IMPORTANT_MESSAGES,
    );

    if (existing.length >= 1) {
      const text =
        '⚠️ Можно подключить только 1 канал к важных сообщениях.\n\n' +
        'Сейчас у вас уже есть подключённый канал.';

      const keyboard = buildImportantMessagesMenuKeyboard();

      if ('callbackQuery' in ctx && ctx.callbackQuery) {
        await ctx.editMessageText(text, { ...keyboard });
      } else {
        await ctx.reply(text, { ...keyboard });
      }

      return;
    }

    await this.userStateService.set(userId, {
      scope: 'important-messages',
      step: 'waiting_for_important_messages_channel_name',
    });

    const text =
      'Отправьте @username канала, который хотите подключить к important-messages.\n\n' +
      'Важно: бот должен быть добавлен администратором в канал и у канала должна быть включена дискуссионная группа.';

    const keyboard = buildImportantMessagesAddChannelKeyboard();

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await ctx.editMessageText(text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async handleCancelAddChannel(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleCancelAddChannel called without userId');
      return;
    }

    await this.userStateService.clear(userId);

    await this.showImportantMessagesMenu(ctx);
  }

  private async handleBackToMainMenu(ctx: Context) {
    await this.menuService.redrawMainMenu(ctx);
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

  private normalizeChannelUsername(input: string): string {
    const raw = (input ?? '').trim();
    if (!raw) return raw;
    return raw.startsWith('@') ? raw : `@${raw}`;
  }
}
