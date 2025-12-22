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

  /**
   * Получение канала по telegram_chat_id
   */
  async getChannelByTelegramChatId(
    telegramChatId: number,
  ): Promise<Channel | null> {
    return this.channelRepository.findOne({
      where: { telegram_chat_id: telegramChatId },
    });
  }
}
