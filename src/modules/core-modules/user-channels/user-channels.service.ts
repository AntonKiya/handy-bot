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

  /**
   * Возвращает список каналов для пользователя по конкретной feature
   * с их telegram_chat_id и username.
   */
  async getChannelsForUserByFeature(
    telegramUserId: number,
    feature: UserChannelFeature,
  ): Promise<ChannelInfo[]> {
    const user = await this.userRepository.findOne({
      where: { telegram_user_id: telegramUserId },
    });

    if (!user) {
      return [];
    }

    const userChannels = await this.userChannelRepository.find({
      where: { user: { id: user.id }, feature },
      relations: ['channel'],
    });

    return userChannels.map((uc) => ({
      telegramChatId: String(uc.channel.telegram_chat_id),
      username: uc.channel.username,
    }));
  }

  async attachChannelToUserFeatureByUsername(
    telegramUserId: number,
    channelUsernameWithAt: string,
    feature: UserChannelFeature,
  ): Promise<
    | { type: 'user-not-found' }
    | { type: 'channel-not-found' }
    | { type: 'already-exists' }
    | { type: 'added' }
  > {
    const user = await this.userRepository.findOne({
      where: { telegram_user_id: telegramUserId },
    });

    if (!user) {
      return { type: 'user-not-found' };
    }

    const username = channelUsernameWithAt.startsWith('@')
      ? channelUsernameWithAt.slice(1)
      : channelUsernameWithAt;

    const channel = await this.channelRepository.findOne({
      where: { username },
    });

    if (!channel) {
      return { type: 'channel-not-found' };
    }

    const existing = await this.userChannelRepository.findOne({
      where: {
        user: { id: user.id },
        channel: { id: channel.id },
        feature,
      },
      relations: ['user', 'channel'],
    });

    if (existing) {
      return { type: 'already-exists' };
    }

    const entity = this.userChannelRepository.create({
      user: { id: user.id } as any,
      channel: { id: channel.id } as any,
      feature,
      // is_admin ставим false по умолчанию, обновим при verify/check (следующий шаг)
      is_admin: false,
    });

    await this.userChannelRepository.save(entity);

    return { type: 'added' };
  }
}
