import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserChannel, UserChannelFeature } from './user-channel.entity';
import { User } from '../user/user.entity';
import { Channel } from '../channel/channel.entity';

export interface ChannelInfo {
  telegramChatId: string;
  username: string | null;
}

@Injectable()
export class UserChannelsService {
  constructor(
    @InjectRepository(UserChannel)
    private readonly userChannelRepository: Repository<UserChannel>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {}

  /**
   * Возвращает список каналов для пользователя с их telegram_chat_id и username.
   */
  async getChannelsForUser(telegramUserId: number): Promise<ChannelInfo[]> {
    const user = await this.userRepository.findOne({
      where: { telegram_user_id: telegramUserId },
    });

    if (!user) {
      return [];
    }

    const userChannels = await this.userChannelRepository.find({
      where: { user: { id: user.id } },
      relations: ['channel'],
    });

    return userChannels.map((uc) => ({
      telegramChatId: String(uc.channel.telegram_chat_id),
      username: uc.channel.username,
    }));
  }

  async getChannelAdminsByTelegramChatId(
    telegramChatId: number,
  ): Promise<number[]> {
    const channel = await this.channelRepository.findOne({
      where: { telegram_chat_id: telegramChatId },
    });

    if (!channel) {
      return [];
    }

    const userChannels = await this.userChannelRepository.find({
      where: {
        channel: { id: channel.id },
        is_admin: true,
      },
      relations: ['user'],
    });

    return userChannels
      .map((uc) => uc.user.telegram_user_id)
      .filter((id) => id != null);
  }

  /**
   * Возвращает список админов канала, которые подключили этот канал для конкретной feature.
   */
  async getChannelAdminsByTelegramChatIdAndFeature(
    telegramChatId: number,
    feature: UserChannelFeature,
  ): Promise<number[]> {
    const channel = await this.channelRepository.findOne({
      where: { telegram_chat_id: telegramChatId },
    });

    if (!channel) {
      return [];
    }

    const userChannels = await this.userChannelRepository.find({
      where: {
        channel: { id: channel.id },
        is_admin: true,
        feature,
      },
      relations: ['user'],
    });

    return userChannels
      .map((uc) => uc.user.telegram_user_id)
      .filter((id) => id != null);
  }
}
