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
  buildImportantMessagesChannelsKeyboard,
  buildImportantMessagesDetachChannelsKeyboard,
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

  async handleGroupMessage(
    ctx: Context,
    messageData: GroupMessageData,
  ): Promise<void> {
    try {
      const savedMessageId =
        await this.importantMessagesService.saveImportantMessage(
          messageData,
          ctx,
        );

      if (!savedMessageId) {
        return;
      }

      const categories =
        await this.importantMessagesService.processGroupMessage(messageData);

      if (!categories || categories.length === 0) {
        return;
      }

      await this.handleImportantMessage(
        ctx,
        messageData,
        categories,
        savedMessageId,
      );
    } catch (error: any) {
      this.logger.error(
        `Error in handleGroupMessage: ${error.message}`,
        error.stack,
      );
    }
  }

  private async handleImportantMessage(
    ctx: Context,
    messageData: GroupMessageData,
    categories: string[],
    savedMessageId: string,
  ): Promise<void> {
    this.logger.debug(
      `Handling important message ${messageData.messageId} from chat ${messageData.chatId}, categories: ${categories.join(', ')}`,
    );

    await this.sendNotificationToAdmins(
      ctx.telegram,
      savedMessageId,
      messageData,
      categories,
    );

    await this.importantMessagesService.updateNotifiedAt(savedMessageId);
  }

  async handleReply(
    ctx: Context,
    chatId: number,
    replyToMessageId: number,
  ): Promise<void> {
    try {
      const channel =
        await this.channelService.getChannelByTelegramChatId(chatId);

      if (!channel) return;

      const message =
        await this.importantMessagesService.getMessageByTelegramId(
          channel.id,
          replyToMessageId,
        );

      if (!message) {
        await this.importantMessagesService.saveMessageForHypeTracking(
          channel.id,
          replyToMessageId,
          ctx,
        );
      }

      await this.importantMessagesService.incrementRepliesCount(
        channel.id,
        replyToMessageId,
      );

      const shouldNotify =
        await this.importantMessagesService.checkHypeThreshold(
          channel.id,
          replyToMessageId,
        );

      if (shouldNotify) {
        await this.sendHypeNotification(ctx, channel.id, replyToMessageId);
      }
    } catch (error: any) {
      this.logger.error(`Error handling reply: ${error.message}`, error.stack);
    }
  }

  async handleReactionCount(
    ctx: Context,
    chatId: number,
    messageId: number,
    oldReaction: ReactionType[],
    newReaction: ReactionType[],
  ): Promise<void> {
    try {
      const channel =
        await this.channelService.getChannelByTelegramChatId(chatId);

      if (!channel) return;

      const message =
        await this.importantMessagesService.getMessageByTelegramId(
          channel.id,
          messageId,
        );

      if (!message) {
        await this.importantMessagesService.saveMessageForHypeTracking(
          channel.id,
          messageId,
          ctx,
        );
      }

      const reactionsCount =
        await this.importantMessagesService.calculateTotalReactions(
          channel.id,
          messageId,
          oldReaction,
          newReaction,
        );

      await this.importantMessagesService.updateReactionsCount(
        channel.id,
        messageId,
        reactionsCount,
      );

      const shouldNotify =
        await this.importantMessagesService.checkHypeThreshold(
          channel.id,
          messageId,
        );

      if (shouldNotify) {
        await this.sendHypeNotification(ctx, channel.id, messageId);
      }
    } catch (error: any) {
      this.logger.error(
        `Error handling reaction count: ${error.message}`,
        error.stack,
      );
    }
  }

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

    await this.importantMessagesService.updateHypeNotifiedAt(
      channelId,
      telegramMessageId,
    );
  }

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

    const text = this.buildNotificationText(messageData, categories);

    let messageLink: string;
    if (channelUsername && postMessageId) {
      messageLink = buildCommentLink(
        channelUsername,
        postMessageId,
        messageData.messageId,
      );
    } else {
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

    for (const adminId of adminIds) {
      try {
        await telegram.sendMessage(adminId, text, keyboard);

        this.logger.debug(
          `Notification sent to admin ${adminId} for message ${messageId}`,
        );
      } catch (error: any) {
        this.logger.warn(
          `Failed to send notification to admin ${adminId}: ${error.message}`,
        );
      }
    }
  }

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

      case ImportantMessagesAction.DetachChannelMenu:
        await this.showDetachChannelMenu(ctx);
        break;

      case ImportantMessagesAction.DetachChannel:
        await this.handleDetachChannel(ctx, parts[2]);
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
    const userId = ctx.from?.id;

    let canDetach = false;
    if (userId) {
      const channels =
        await this.userChannelsService.getChannelsForUserByFeature(
          userId,
          UserChannelFeature.IMPORTANT_MESSAGES,
        );
      canDetach = channels.length > 0;
    }

    const text = 'Важные сообщения — меню';
    const keyboard = buildImportantMessagesMenuKeyboard(canDetach);

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

    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.IMPORTANT_MESSAGES,
    );

    const canAdd = channels.length < 1;

    let text: string;
    if (!channels.length) {
      text = 'У вас пока нет каналов, подключённых к important-messages.';
    } else {
      text =
        '⚠️ Лимит: можно подключить только 1 канал на пользователя.\n\n' +
        'Ваши каналы для important-messages:\n\n' +
        channels
          .map((ch) =>
            ch.username ? `• @${ch.username}` : `• ID: ${ch.telegramChatId}`,
          )
          .join('\n');
    }

    if (notice) {
      text = `${notice}\n\n${text}`;
    }

    const keyboard = buildImportantMessagesChannelsKeyboard(canAdd);

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async showDetachChannelMenu(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('showDetachChannelMenu called without userId');
      return;
    }

    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.IMPORTANT_MESSAGES,
    );

    if (!channels.length) {
      await this.showImportantMessagesMenu(ctx);
      return;
    }

    const text =
      'Выберите канал который хотите отвязать от функции важных сообщений:';

    const keyboard = buildImportantMessagesDetachChannelsKeyboard(channels);

    if ('callbackQuery' in ctx && ctx.callbackQuery) {
      await this.safeEditMessageText(ctx, text, { ...keyboard });
    } else {
      await ctx.reply(text, { ...keyboard });
    }
  }

  private async handleDetachChannel(ctx: Context, telegramChatIdRaw?: string) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('handleDetachChannel called without userId');
      return;
    }

    const telegramChatId = Number(telegramChatIdRaw);
    if (!telegramChatIdRaw || Number.isNaN(telegramChatId)) {
      if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
        await ctx.answerCbQuery('Ошибка');
      }
      return;
    }

    const result =
      await this.userChannelsService.detachChannelFromUserFeatureByTelegramChatId(
        userId,
        telegramChatId,
        UserChannelFeature.IMPORTANT_MESSAGES,
      );

    if (result.type === 'detached') {
      await this.showMyChannels(ctx, '✅ Отвязано. Текущий список каналов:');
      return;
    }

    if (result.type === 'not-found') {
      await this.showImportantMessagesMenu(ctx);
      return;
    }

    if (result.type === 'channel-not-found') {
      await this.showImportantMessagesMenu(ctx);
      return;
    }

    if (result.type === 'user-not-found') {
      await this.showImportantMessagesMenu(ctx);
      return;
    }

    await this.showImportantMessagesMenu(ctx);
  }

  private async startAddChannel(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      this.logger.warn('startAddChannel called without userId');
      return;
    }

    // MVP-лимит: 1 канал на пользователя
    const channels = await this.userChannelsService.getChannelsForUserByFeature(
      userId,
      UserChannelFeature.IMPORTANT_MESSAGES,
    );

    if (channels.length >= 1) {
      // Просто показываем список + только "Назад" (кнопка "Добавить" не нужна)
      await this.showMyChannels(ctx);
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
      await this.safeEditMessageText(ctx, text, { ...keyboard });
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

  private async handleDoneAction(ctx: Context): Promise<void> {
    try {
      if ('deleteMessage' in ctx && typeof ctx.deleteMessage === 'function') {
        await ctx.deleteMessage();
      }

      if ('answerCbQuery' in ctx && typeof ctx.answerCbQuery === 'function') {
        await ctx.answerCbQuery('✅ Готово');
      }
    } catch (error: any) {
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
