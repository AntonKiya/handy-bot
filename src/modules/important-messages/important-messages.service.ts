import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReactionType } from 'telegraf/types';
import { ImportantMessage } from './important-message.entity';
import { CategorizationService } from './categorization.service';
import { GroupMessageData } from '../../telegram-bot/utils/types';
import { getWordCount } from './utils/text-normalizer.util';
import { MIN_WORD_COUNT, THRESHOLDS } from './important-messages.constants';
import { ChannelService } from '../channel/channel.service';
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

    // Сохраняем в БД
    const importantMessage = this.importantMessageRepository.create({
      channel: { id: channel.id },
      telegram_message_id: messageId,
      telegram_user_id: userId,
      text,
      notified_at: null,
      replies_count: 0,
      reactions_count: 0,
      hype_notified_at: null,
    });

    const saved = await this.importantMessageRepository.save(importantMessage);

    this.logger.debug(`Saved important message: id=${saved.id}`);

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
    return (message.reactions_count += delta);
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
   * Используется когда на пост отвечают, но сам пост не был сохранен
   */
  async saveMessageForHypeTracking(
    channelId: string,
    telegramMessageId: number,
    telegramUserId?: number,
    text?: string | null,
  ): Promise<void> {
    const existing = await this.importantMessageRepository.findOne({
      where: {
        channel: { id: channelId },
        telegram_message_id: telegramMessageId,
      },
    });
    if (existing) return;

    const importantMessage = this.importantMessageRepository.create({
      channel: { id: channelId },
      telegram_message_id: telegramMessageId,
      telegram_user_id: telegramUserId ?? 0, // временно ок, но лучше nullable
      text: text ?? null,
      notified_at: null,
      replies_count: 0,
      reactions_count: 0,
      hype_notified_at: null,
    });

    await this.importantMessageRepository.save(importantMessage);
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
