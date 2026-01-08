import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UserChannel, UserChannelFeature } from './user-channel.entity';
import { User } from '../user/user.entity';
import { Channel } from '../channel/channel.entity';
import { ChannelService } from '../channel/channel.service';

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
    private readonly channelService: ChannelService,
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
      where: { user: { id: user.id }, deleted_at: IsNull() },
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
        deleted_at: IsNull(),
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
        deleted_at: IsNull(),
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
      where: { user: { id: user.id }, feature, deleted_at: IsNull() },
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
    isAdmin: boolean = false,
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

    const channel = await this.channelService.getChannelByUsername(
      channelUsernameWithAt,
    );

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
      // Воскрешение soft-deleted записи (upsert по уникальному ключу)
      if (existing.deleted_at) {
        await this.userChannelRepository.update(
          { id: existing.id },
          {
            deleted_at: null,
            is_admin: existing.is_admin === true ? true : isAdmin,
          },
        );
        return { type: 'added' };
      }

      // Если мы точно знаем, что пользователь админ — фиксируем это в связке (не понижаем обратно)
      if (isAdmin && existing.is_admin !== true) {
        await this.userChannelRepository.update(
          { id: existing.id },
          { is_admin: true },
        );
      }

      return { type: 'already-exists' };
    }

    const entity = this.userChannelRepository.create({
      user: { id: user.id } as any,
      channel: { id: channel.id } as any,
      feature,
      is_admin: isAdmin,
      deleted_at: null,
    });

    await this.userChannelRepository.save(entity);

    return { type: 'added' };
  }

  async detachChannelFromUserFeatureByTelegramChatId(
    telegramUserId: number,
    telegramChatId: number,
    feature: UserChannelFeature,
  ): Promise<
    | { type: 'user-not-found' }
    | { type: 'channel-not-found' }
    | { type: 'not-found' }
    | { type: 'detached' }
  > {
    const user = await this.userRepository.findOne({
      where: { telegram_user_id: telegramUserId },
    });

    if (!user) {
      return { type: 'user-not-found' };
    }

    const channel = await this.channelRepository.findOne({
      where: { telegram_chat_id: telegramChatId },
    });

    if (!channel) {
      return { type: 'channel-not-found' };
    }

    const existing = await this.userChannelRepository.findOne({
      where: {
        user: { id: user.id },
        channel: { id: channel.id },
        feature,
        deleted_at: IsNull(),
      },
    });

    if (!existing) {
      return { type: 'not-found' };
    }

    await this.userChannelRepository.update(
      { id: existing.id },
      { deleted_at: new Date() },
    );

    return { type: 'detached' };
  }
}
