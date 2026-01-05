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
}
