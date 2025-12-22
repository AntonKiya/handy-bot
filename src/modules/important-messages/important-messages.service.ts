import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportantMessage } from './important-message.entity';
import { Channel } from '../channel/channel.entity';
import { CategorizationService } from './categorization.service';
import { GroupMessageData } from '../../telegram-bot/utils/types';
import { getWordCount } from './utils/text-normalizer.util';
import { MIN_WORD_COUNT } from './important-messages.constants';
import { ChannelService } from '../channel/channel.service';

@Injectable()
export class ImportantMessagesService {
  private readonly logger = new Logger(ImportantMessagesService.name);

  constructor(
    @InjectRepository(ImportantMessage)
    private readonly importantMessageRepository: Repository<ImportantMessage>,
    @InjectRepository(Channel)
    private readonly channelService: ChannelService,
    private readonly categorizationService: CategorizationService,
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
   * Сохранение важного сообщения и подготовка к отправке уведомлений
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

    // Сохраняем в БД
    const importantMessage = this.importantMessageRepository.create({
      channel: { id: channel.id },
      telegram_message_id: messageId,
      telegram_user_id: userId,
      text,
      notified_at: null,
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
}
