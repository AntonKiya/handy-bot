import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {}

  async getById(channelId: string): Promise<Channel | null> {
    return this.channelRepository.findOne({
      where: { id: channelId },
    });
  }

  /**
   * Получение канала по telegram_chat_id
   */
  async getChannelByTelegramChatId(chatId: number): Promise<Channel | null> {
    return this.channelRepository.findOne({
      where: [
        { telegram_chat_id: chatId }, // Основной канал
        { discussion_group_id: chatId }, // Группа обсуждений канала
      ],
    });
  }

  /**
   * Получение канала по @username (или username без @)
   */
  async getChannelByUsername(usernameWithAt: string): Promise<Channel | null> {
    const username = (usernameWithAt ?? '').trim().replace(/^@/, '');
    if (!username) {
      return null;
    }

    return this.channelRepository.findOne({
      where: { username },
    });
  }

  /**
   * Создаёт или обновляет запись канала по данным из Telegram (Bot API getChat).
   * Используется в сценарии A: сначала проверки, потом сохранение в БД.
   */
  async upsertChannelFromTelegram(params: {
    telegramChatId: number;
    username: string | null;
    discussionGroupChatId: number | null;
  }): Promise<Channel> {
    const username = (params.username ?? '').trim().replace(/^@/, '') || null;

    const where: any[] = [{ telegram_chat_id: String(params.telegramChatId) }];
    if (username) {
      where.push({ username });
    }

    let channel = await this.channelRepository.findOne({ where });

    if (!channel) {
      channel = this.channelRepository.create({
        telegram_chat_id: String(params.telegramChatId) as any,
        username: username as any,
        discussion_group_id: params.discussionGroupChatId
          ? (String(params.discussionGroupChatId) as any)
          : null,
      });
    } else {
      (channel as any).telegram_chat_id = String(params.telegramChatId);
      (channel as any).discussion_group_id = params.discussionGroupChatId
        ? String(params.discussionGroupChatId)
        : null;

      if (username) {
        (channel as any).username = username;
      }
    }

    return this.channelRepository.save(channel);
  }
}
