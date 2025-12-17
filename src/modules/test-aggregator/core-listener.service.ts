import { Injectable, Logger } from '@nestjs/common';
import { TelegramCoreService } from '../../telegram-core/telegram-core.service';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import { MessageMetadata } from './bot-listener.service';

@Injectable()
export class CoreListenerService {
  private readonly logger = new Logger(CoreListenerService.name);

  // Захардкоженные группы и каналы для тестирования
  private readonly TEST_GROUPS = ['@wed2231d'];

  private readonly TEST_CHANNELS = ['@test_chabbel_123'];

  // Дедупликация сообщений
  private processedMessages = new Set<string>();

  // Метрики
  private messageStats = {
    groupMessages: 0,
    channelPosts: 0,
    channelComments: 0,
  };

  constructor(private readonly telegramCore: TelegramCoreService) {}

  async init() {
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log('🔧 Core API Listener initializing...');
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      const client = await this.telegramCore.getClient();

      // Активируем получение обновлений
      await client.getMe();
      this.logger.log('✅ Core API client activated');

      // Собираем все ID
      const groupIds = new Set<string>();
      const channelIds = new Set<string>();
      const discussionGroupIds = new Set<string>();

      // Подписываемся на группы
      if (this.TEST_GROUPS.length > 0) {
        await this.collectGroups(client, groupIds);
      }

      // Подписываемся на каналы
      if (this.TEST_CHANNELS.length > 0) {
        await this.collectChannels(client, channelIds, discussionGroupIds);
      }

      // ОДИН ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ДЛЯ ВСЕХ
      this.registerGlobalEventHandler(
        client,
        groupIds,
        channelIds,
        discussionGroupIds,
      );

      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.log('✅ Core API Listener fully initialized');
      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Core API Listener', error);
    }
  }

  /**
   * Собираем ID групп
   */
  private async collectGroups(client: any, groupIds: Set<string>) {
    this.logger.log('👥 Collecting groups...');

    for (const username of this.TEST_GROUPS) {
      try {
        const entity = await client.getEntity(username);
        const groupId = entity.id?.toString();

        if (groupId) {
          groupIds.add(groupId);
          groupIds.add(`-100${groupId}`);
          this.logger.log(`  ✅ ${username} (ID: ${groupId}, -100${groupId})`);
        }
      } catch (error) {
        this.logger.error(`  ❌ ${username}: ${error.message}`);
      }
    }

    if (groupIds.size > 0) {
      this.logger.log(`✅ Found ${groupIds.size / 2} groups`);
    }
  }

  /**
   * Собираем ID каналов и discussion groups
   */
  private async collectChannels(
    client: any,
    channelIds: Set<string>,
    discussionGroupIds: Set<string>,
  ) {
    this.logger.log('📺 Collecting channels...');

    for (const channelUsername of this.TEST_CHANNELS) {
      try {
        // Получаем канал
        const channel = await client.getEntity(channelUsername);
        const channelId = channel.id?.toString();

        if (channelId) {
          channelIds.add(channelId);
          channelIds.add(`-100${channelId}`);
          this.logger.log(
            `  ✅ ${channelUsername} (ID: ${channelId}, -100${channelId})`,
          );
        }

        // Ищем discussion group
        const discussionGroupId =
          await this.getChannelDiscussionGroup(channelUsername);

        if (discussionGroupId) {
          const discussionGroupIdStr = discussionGroupId.toString();
          discussionGroupIds.add(discussionGroupIdStr);
          discussionGroupIds.add(`-100${discussionGroupIdStr}`);

          this.logger.log(
            `  💬 Discussion group (ID: ${discussionGroupIdStr}, -100${discussionGroupIdStr})`,
          );

          // Автоматическая подписка
          await this.autoJoinDiscussionGroup(
            client,
            discussionGroupId,
            channelUsername,
          );
        } else {
          this.logger.log(`  ℹ️  ${channelUsername}: no discussion group`);
        }
      } catch (error) {
        this.logger.error(`  ❌ ${channelUsername}: ${error.message}`);
      }
    }

    if (channelIds.size > 0) {
      this.logger.log(`✅ Found ${channelIds.size / 2} channels`);
    }
    if (discussionGroupIds.size > 0) {
      this.logger.log(
        `✅ Found ${discussionGroupIds.size / 2} discussion groups`,
      );
    }
  }

  /**
   * Регистрация единого обработчика событий для всех типов
   */
  private registerGlobalEventHandler(
    client: any,
    groupIds: Set<string>,
    channelIds: Set<string>,
    discussionGroupIds: Set<string>,
  ) {
    this.logger.log('🎯 Registering global event handler...');
    this.logger.log(`  Tracking group IDs: ${Array.from(groupIds).join(', ')}`);
    this.logger.log(
      `  Tracking channel IDs: ${Array.from(channelIds).join(', ')}`,
    );
    this.logger.log(
      `  Tracking discussion IDs: ${Array.from(discussionGroupIds).join(', ')}`,
    );

    client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        const chatId = message.chatId?.toString();

        if (!chatId) {
          this.logger.debug('No chatId in message, skipping');
          return;
        }

        // Дедупликация
        if (this.isMessageProcessed(chatId, message.id)) {
          return;
        }

        // Логируем входящее сообщение для отладки
        this.logger.debug(`📨 Incoming message from chatId: ${chatId}`);

        // Определяем тип сообщения по chatId
        if (groupIds.has(chatId)) {
          this.logger.debug(`✅ Matched as GROUP`);
          await this.handleGroupMessage(event);
        } else if (channelIds.has(chatId)) {
          this.logger.debug(`✅ Matched as CHANNEL POST`);
          await this.handleChannelPost(event);
        } else if (discussionGroupIds.has(chatId)) {
          this.logger.debug(`✅ Matched as DISCUSSION GROUP COMMENT`);
          await this.handleChannelComment(event);
        } else {
          this.logger.debug(
            `⚠️  chatId ${chatId} not in any tracked lists, ignoring`,
          );
        }
      } catch (error) {
        this.logger.error('Error handling event:', error.message);
        this.logger.error('Stack:', error.stack);
      }
    }, new NewMessage({}));

    this.logger.log('✅ Global event handler registered');
  }

  /**
   * Проверка и добавление в кэш обработанных сообщений
   */
  private isMessageProcessed(chatId: string, messageId: number): boolean {
    const key = `${chatId}:${messageId}`;

    if (this.processedMessages.has(key)) {
      return true;
    }

    this.processedMessages.add(key);

    // Очищаем из кэша через 60 секунд
    setTimeout(() => {
      this.processedMessages.delete(key);
    }, 60000);

    return false;
  }

  /**
   * Автоматическая подписка на discussion group
   */
  private async autoJoinDiscussionGroup(
    client: any,
    discussionGroupId: bigInt.BigInteger,
    channelUsername: string,
  ) {
    try {
      const discussionGroup = await client.getEntity(discussionGroupId);

      // Проверяем, являемся ли мы уже участником
      await client.invoke(
        new Api.channels.GetParticipant({
          channel: discussionGroup,
          participant: 'me',
        }),
      );

      // Если дошли сюда - значит уже участник
      this.logger.log(
        `  ✅ ${channelUsername}: already member of discussion group`,
      );
    } catch (error) {
      // Если не участник (USER_NOT_PARTICIPANT), пытаемся вступить
      if (error.message.includes('USER_NOT_PARTICIPANT')) {
        try {
          await client.invoke(
            new Api.channels.JoinChannel({
              channel: await client.getEntity(discussionGroupId),
            }),
          );
          this.logger.log(
            `  ✅ ${channelUsername}: auto-joined discussion group`,
          );
        } catch (joinError) {
          if (joinError.message.includes('INVITE_REQUEST_SENT')) {
            this.logger.warn(
              `  ⚠️  ${channelUsername}: join request sent (approval needed)`,
            );
          } else if (joinError.message.includes('CHANNEL_PRIVATE')) {
            this.logger.warn(
              `  ⚠️  ${channelUsername}: discussion group is private (manual join required)`,
            );
          } else {
            this.logger.error(
              `  ❌ ${channelUsername}: failed to join discussion group: ${joinError.message}`,
            );
          }
        }
      }
    }
  }

  /**
   * Получить ID группы обсуждений для канала
   */
  private async getChannelDiscussionGroup(
    channelUsername: string,
  ): Promise<bigInt.BigInteger | null> {
    const client = await this.telegramCore.getClient();

    try {
      const channel = (await client.getEntity(channelUsername)) as Api.Channel;

      const fullChannel = await client.invoke(
        new Api.channels.GetFullChannel({
          channel: channel,
        }),
      );

      if (fullChannel.fullChat instanceof Api.ChannelFull) {
        return fullChannel.fullChat.linkedChatId || null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Обработка сообщений из групп
   */
  private async handleGroupMessage(event: NewMessageEvent) {
    const message = event.message;
    const sender = await message.getSender();
    const chat = await event.getChat();

    this.messageStats.groupMessages++;

    const metadata: MessageMetadata = {
      source: 'core-api',
      type: 'group_message',
      chatId: message.chatId?.toString() || 'unknown',
      chatTitle: (chat as any)?.title || 'Unknown Group',
      messageId: message.id,
      senderId: sender?.id?.toString() || 'unknown',
      senderName:
        (sender as any)?.firstName ||
        (sender as any)?.username ||
        'Unknown User',
      text: message.message || '[No text]',
      timestamp: new Date(message.date * 1000),
      isReply: !!message.replyTo,
      replyToMessageId:
        message.replyTo && 'replyToMsgId' in message.replyTo
          ? message.replyTo.replyToMsgId
          : undefined,
    };

    this.logMessage(metadata, '4️⃣ USER SESSION → GROUP MESSAGE');
  }

  /**
   * Обработка постов в каналах
   */
  private async handleChannelPost(event: NewMessageEvent) {
    const message = event.message;
    const chat = await event.getChat();

    // УБРАЛ ПРОВЕРКУ broadcast - она блокировала посты!
    // if (!(chat && 'broadcast' in chat && chat.broadcast)) {
    //   return;
    // }

    this.messageStats.channelPosts++;

    const metadata: MessageMetadata = {
      source: 'core-api',
      type: 'channel_post',
      chatId: message.chatId?.toString() || 'unknown',
      chatTitle: (chat as any)?.title || 'Unknown Channel',
      messageId: message.id,
      senderId: 'channel',
      senderName: (chat as any)?.title || 'Channel',
      text: message.message || '[No text]',
      timestamp: new Date(message.date * 1000),
      isReply: false,
    };

    this.logMessage(metadata, '5️⃣ USER SESSION → CHANNEL POST');
  }

  /**
   * Обработка комментариев к постам канала
   */
  private async handleChannelComment(event: NewMessageEvent) {
    const message = event.message;
    const sender = await message.getSender();
    const chat = await event.getChat();

    if (!message.replyTo || !('replyToMsgId' in message.replyTo)) {
      return;
    }

    this.messageStats.channelComments++;

    const metadata: MessageMetadata = {
      source: 'core-api',
      type: 'channel_comment',
      chatId: message.chatId?.toString() || 'unknown',
      chatTitle: (chat as any)?.title || 'Unknown Discussion Group',
      messageId: message.id,
      senderId: sender?.id?.toString() || 'unknown',
      senderName:
        (sender as any)?.firstName ||
        (sender as any)?.username ||
        'Unknown User',
      text: message.message || '[No text]',
      timestamp: new Date(message.date * 1000),
      isReply: true,
      replyToMessageId: message.replyTo.replyToMsgId,
    };

    this.logMessage(metadata, '6️⃣ USER SESSION → CHANNEL COMMENT');
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
    if (total % 10 === 0 && total > 0) {
      this.logger.log('📊 Stats: ' + JSON.stringify(this.messageStats));
    }
  }
}
