import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Context } from 'telegraf';
import { ReactionType } from 'telegraf/types';
import { ImportantMessage } from './important-message.entity';
import { CategorizationService } from './categorization.service';
import { GroupMessageData } from '../../../telegram-bot/utils/types';
import { getWordCount } from './utils/text-normalizer.util';
import { MIN_WORD_COUNT, THRESHOLDS } from './important-messages.constants';
import { ChannelService } from '../../core-modules/channel/channel.service';
import { HypeScorer } from './utils/scorers/hype.scorer';

@Injectable()
export class ImportantMessagesService {
  private readonly logger = new Logger(ImportantMessagesService.name);

  constructor(
    @InjectRepository(ImportantMessage)
    private readonly importantMessageRepository: Repository<ImportantMessage>,
    private readonly channelService: ChannelService,
    private readonly categorizationService: CategorizationService,
    private readonly hypeScorer: HypeScorer,
  ) {}

  /**
   * Определение post_message_id (ID поста в канале)
   *
   * Случай 1: Автофорвард поста → берем forward_from_message_id
   * Случай 2: Первый комментарий → берем из reply_to_message.forward_from_message_id
   * Случай 3: Reply на комментарий → ищем reply_to_message в БД
   */
  async resolvePostMessageId(
    ctx: Context,
    channelId: string,
  ): Promise<number | null> {
    const message = ctx.message as any;
    if (!message) return null;

    // Получаем наш канал для проверки
    const ourChannel = await this.channelService.getById(channelId);
    const ourChannelChatId = Number(ourChannel.telegram_chat_id);

    // Случай 1: Автофорвард ТОЛЬКО из НАШЕГО канала
    if (
      message.is_automatic_forward === true &&
      message.forward_from_chat?.id === ourChannelChatId &&
      message.forward_from_message_id
    ) {
      this.logger.debug(
        `Post auto-forward from our channel: ${message.forward_from_message_id}`,
      );
      return message.forward_from_message_id;
    }

    // Случай 2: Первый комментарий на автофорвард НАШЕГО канала
    const replyTo = message.reply_to_message;
    if (
      replyTo?.is_automatic_forward === true &&
      replyTo.forward_from_chat?.id === ourChannelChatId &&
      replyTo.forward_from_message_id
    ) {
      this.logger.debug(
        `First comment on our channel post: ${replyTo.forward_from_message_id}`,
      );
      return replyTo.forward_from_message_id;
    }

    // Случай 3: Reply на комментарий
    // Ищем reply_to_message в БД и берем его post_message_id
    if (replyTo?.message_id) {
      const replyToMessage = await this.importantMessageRepository.findOne({
        where: {
          channel: { id: channelId },
          telegram_message_id: replyTo.message_id,
        },
      });

      if (replyToMessage?.post_message_id) {
        this.logger.debug(
          `Found post_message_id from reply_to_message: ${replyToMessage.post_message_id}`,
        );
        return Number(replyToMessage.post_message_id);
      }
    }

    // Случай 4: Fallback - ищем через message_thread_id
    if (message.message_thread_id) {
      const threadMessage = await this.importantMessageRepository.findOne({
        where: {
          channel: { id: channelId },
          telegram_message_id: message.message_thread_id,
        },
      });

      if (threadMessage?.post_message_id) {
        this.logger.debug(
          `Found post_message_id in thread root: ${threadMessage.post_message_id}`,
        );
        return Number(threadMessage.post_message_id);
      }
    }

    return null;
  }

  async getById(id: string): Promise<ImportantMessage | null> {
    return this.importantMessageRepository.findOne({
      where: { id },
      relations: ['channel'],
    });
  }

  /**
   * Обработка входящего сообщения из группы
   * Возвращает категории если сообщение важное, иначе null
   *
   * Вызывается из Flow
   */
  async processGroupMessage(
    messageData: GroupMessageData,
  ): Promise<string[] | null> {
    const { text, messageId, chatId } = messageData;

    if (messageData.chatType === 'channel') {
      this.logger.debug(`Post in channel ${chatId}, skipping`);
      return null;
    }

    // Проверка наличия текста
    if (!text || text.trim().length === 0) {
      this.logger.debug(`No text in message ${messageId}, skipping`);
      return null;
    }

    // Проверка минимальной длины
    const wordCount = getWordCount(text);
    if (wordCount < MIN_WORD_COUNT) {
      this.logger.debug(
        `Message ${messageId} too short (${wordCount} words), skipping`,
      );
      return null;
    }

    // Получаем канал из БД
    const channel =
      await this.channelService.getChannelByTelegramChatId(chatId);

    if (!channel) {
      this.logger.debug(
        `Channel not found for chat_id ${chatId}, skipping message`,
      );
      return null;
    }

    // Категоризация сообщения
    const result = await this.categorizationService.categorizeMessage({
      text,
      channelId: channel.id,
    });

    // Если нет категорий - сообщение не важное
    if (result.categories.length === 0) {
      this.logger.debug(
        `Message ${messageId} in chat ${chatId} is not important`,
      );
      return null;
    }

    this.logger.log(
      `Important message detected: ${messageId} in chat ${chatId}, categories: ${result.categories.join(', ')}`,
    );

    return result.categories;
  }

  /**
   * Сохранение важного сообщения
   * Возвращает ID сохраненного сообщения
   *
   * Вызывается из Flow
   */
  async saveImportantMessage(
    messageData: GroupMessageData,
    ctx: Context,
  ): Promise<string | null> {
    const { chatId, messageId, userId, text } = messageData;

    // Получаем канал
    const channel =
      await this.channelService.getChannelByTelegramChatId(chatId);

    if (!channel) {
      this.logger.warn(
        `Channel not found for chat_id ${chatId}, skipping save`,
      );
      return null;
    }

    // Пропускаем автофорварды (посты) - админ и так знает о своем посте
    const message = ctx.message as any;
    if (message?.is_automatic_forward === true) {
      this.logger.debug(
        `Skipping auto-forward (post) ${messageId} - no notification needed`,
      );
      return null;
    }

    const existing = await this.importantMessageRepository.findOne({
      where: {
        channel: { id: channel.id },
        telegram_message_id: messageId,
      },
    });

    if (existing) {
      this.logger.debug(
        `Message ${messageId} already exists, returning existing id: ${existing.id}`,
      );
      return existing.id;
    }

    // Определяем post_message_id
    const postMessageId = await this.resolvePostMessageId(ctx, channel.id);

    const importantMessage = this.importantMessageRepository.create({
      channel: { id: channel.id },
      telegram_message_id: messageId,
      telegram_user_id: userId,
      text,
      notified_at: null,
      replies_count: 0,
      reactions_count: 0,
      hype_notified_at: null,
      post_message_id: postMessageId,
    });

    const saved = await this.importantMessageRepository.save(importantMessage);

    this.logger.debug(
      `Saved important message: id=${saved.id}, post_message_id=${postMessageId}`,
    );

    return saved.id;
  }

  /**
   * Обновление времени отправки уведомления
   *
   * Вызывается из Flow
   */
  async updateNotifiedAt(messageId: string): Promise<void> {
    await this.importantMessageRepository.update(
      { id: messageId },
      { notified_at: new Date() },
    );
  }

  // ============= HYPE METHODS =============

  /**
   * Подсчет общего количества реакций
   * Вызывается из Flow
   */
  async calculateTotalReactions(
    channelId: string,
    messageId: number,
    oldReaction: ReactionType[],
    newReaction: ReactionType[],
  ): Promise<number> {
    const message = await this.getMessageByTelegramId(channelId, messageId);
    const delta = (newReaction?.length ?? 0) - (oldReaction?.length ?? 0);
    return message.reactions_count + delta;
  }

  /**
   * Получение сообщения по telegram_message_id и channelId
   */
  async getMessageByTelegramId(
    channelId: string,
    telegramMessageId: number,
  ): Promise<ImportantMessage | null> {
    return this.importantMessageRepository.findOne({
      where: {
        channel: { id: channelId },
        telegram_message_id: telegramMessageId,
      },
      relations: ['channel'],
    });
  }

  /**
   * Сохранение сообщения для отслеживания hype (минимальная запись)
   * Используется когда на пост/комментарий отвечают, но сам пост/комментарий не был сохранен
   */
  async saveMessageForHypeTracking(
    channelId: string,
    telegramMessageId: number,
    ctx: Context,
  ): Promise<void> {
    const existing = await this.importantMessageRepository.findOne({
      where: {
        channel: { id: channelId },
        telegram_message_id: telegramMessageId,
      },
    });
    if (existing) return;

    // Получаем данные из reply_to_message
    const replyToMessage = (ctx.message as any)?.reply_to_message;

    // Пропускаем автофорварды (посты) - hype на посты не нужен
    if (replyToMessage?.is_automatic_forward === true) {
      this.logger.debug(
        `Skipping auto-forward (post) ${telegramMessageId} - no hype tracking for posts`,
      );
      return;
    }

    const userId = replyToMessage?.from?.id || 0;
    const text = replyToMessage?.text || null;

    // Определяем post_message_id
    const postMessageId = await this.resolvePostMessageId(ctx, channelId);

    const importantMessage = this.importantMessageRepository.create({
      channel: { id: channelId },
      telegram_message_id: telegramMessageId,
      telegram_user_id: userId,
      text,
      notified_at: null,
      replies_count: 0,
      reactions_count: 0,
      hype_notified_at: null,
      post_message_id: postMessageId,
    });

    await this.importantMessageRepository.save(importantMessage);

    this.logger.debug(
      `Created hype tracking entry for message ${telegramMessageId}, post_message_id=${postMessageId}`,
    );
  }

  /**
   * Инкремент счетчика ответов
   * Вызывается из Flow
   */
  async incrementRepliesCount(
    channelId: string,
    telegramMessageId: number,
  ): Promise<void> {
    await this.importantMessageRepository.increment(
      {
        channel: { id: channelId },
        telegram_message_id: telegramMessageId,
      },
      'replies_count',
      1,
    );

    this.logger.debug(
      `Incremented replies_count for message ${telegramMessageId} in channel ${channelId}`,
    );
  }

  /**
   * Обновление счетчика реакций
   * Вызывается из Flow при событии message_reaction_count
   */
  async updateReactionsCount(
    channelId: string,
    telegramMessageId: number,
    reactionsCount: number,
  ): Promise<void> {
    await this.importantMessageRepository.update(
      {
        channel: { id: channelId },
        telegram_message_id: telegramMessageId,
      },
      { reactions_count: reactionsCount },
    );

    this.logger.debug(
      `Updated reactions_count to ${reactionsCount} for message ${telegramMessageId} in channel ${channelId}`,
    );
  }

  /**
   * Проверка hype порога
   * Возвращает true если порог достигнут и уведомление еще не отправлено
   *
   * Вызывается из Flow
   */
  async checkHypeThreshold(
    channelId: string,
    telegramMessageId: number,
  ): Promise<boolean> {
    const message = await this.getMessageByTelegramId(
      channelId,
      telegramMessageId,
    );

    if (!message) {
      return false;
    }

    // Проверяем что уведомление еще не отправлено
    if (message.hype_notified_at !== null) {
      return false;
    }

    // Вычисляем hype score используя АКТУАЛЬНЫЕ данные из БД
    const hypeResult = this.hypeScorer.calculateScore(
      message.reactions_count,
      message.replies_count,
    );

    this.logger.debug(
      `Hype score for message ${message.telegram_message_id}: ${hypeResult.score} (reactions: ${message.reactions_count}, replies: ${message.replies_count})`,
    );

    // Возвращаем true если порог достигнут
    return hypeResult.score >= THRESHOLDS.HYPE;
  }

  /**
   * Обновление времени отправки hype уведомления
   *
   * Вызывается из Flow после отправки уведомления
   */
  async updateHypeNotifiedAt(
    channelId: string,
    telegramMessageId: number,
  ): Promise<void> {
    await this.importantMessageRepository.update(
      {
        channel: { id: channelId },
        telegram_message_id: telegramMessageId,
      },
      { hype_notified_at: new Date() },
    );
  }
}
