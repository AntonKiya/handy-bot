import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserChannel } from './user-channel.entity';
import { User } from '../user/user.entity';
import { Channel } from '../channel/channel.entity';
import { Context } from 'telegraf';

export type HandleMyChatMemberResult =
  | {
      type: 'linked';
      data: {
        userId: string;
        channelId: string;
        actorTelegramId: number;
        channelTitle: string | null;
      };
    }
  | {
      type: 'skipped';
      reason:
        | 'bot-not-admin'
        | 'no-actor'
        | 'actor-not-admin'
        | 'user-not-found'
        | 'channel-not-found';
    };

export interface ChannelInfo {
  telegramChatId: string;
  username: string | null;
}

@Injectable()
export class UserChannelsService {
  private readonly logger = new Logger(UserChannelsService.name);

  constructor(
    @InjectRepository(UserChannel)
    private readonly userChannelRepository: Repository<UserChannel>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {}

  async handleMyChatMember(
    ctx: Context,
    update: any,
  ): Promise<HandleMyChatMemberResult> {
    const chat = update.chat; // канал
    const actor = update.from; // кто добавил/изменил статус бота
    const botMember = update.new_chat_member; // новый статус БОТА в этом чате
    const botStatus = botMember?.status;

    const chatId = chat.id as number;
    const actorId = actor?.id as number | undefined;

    this.logger.debug(
      `handleMyChatMember: chatId=${chatId}, botStatus=${botStatus}, actor=${actorId}`,
    );

    // 1) Бизнес-правило: считаем канал подключённым, только если бот админ
    if (botStatus !== 'administrator') {
      this.logger.debug(
        `Bot status in chat ${chatId} is "${botStatus}", channel will not be linked.`,
      );
      return { type: 'skipped', reason: 'bot-not-admin' };
    }

    if (!actorId) {
      this.logger.warn(
        `my_chat_member for chat ${chatId} without actor (from), skipping.`,
      );
      return { type: 'skipped', reason: 'no-actor' };
    }

    // 2) Проверяем, что человек, который добавил бота - creator или admin
    const member = await ctx.telegram.getChatMember(chatId, actorId);

    if (!['creator', 'administrator'].includes(member.status)) {
      this.logger.debug(
        `User ${actorId} in chat ${chatId} has status "${member.status}", not allowed to link channel.`,
      );
      return { type: 'skipped', reason: 'actor-not-admin' };
    }

    // 3) Апсерт пользователя с обновлением username
    await this.userRepository.upsert(
      {
        telegram_user_id: actorId,
        username: actor?.username ?? null,
      },
      { conflictPaths: ['telegram_user_id'] },
    );
    const user = await this.userRepository.findOne({
      where: { telegram_user_id: actorId },
    });

    if (!user) {
      this.logger.error(
        `User upsert failed or not found: telegram_user_id=${actorId}`,
      );
      return { type: 'skipped', reason: 'user-not-found' };
    }

    this.logger.debug(
      `User upserted/retrieved: telegram_user_id=${actorId}, id=${user.id}, username=${user.username}`,
    );

    // 4) Апсерт канала с обновлением username
    await this.channelRepository.upsert(
      {
        telegram_chat_id: chatId,
        username: chat.username ?? null,
      },
      { conflictPaths: ['telegram_chat_id'] },
    );
    const channel = await this.channelRepository.findOne({
      where: { telegram_chat_id: chatId },
    });

    if (!channel) {
      this.logger.error(
        `Channel upsert failed or not found: telegram_chat_id=${chatId}`,
      );
      return { type: 'skipped', reason: 'channel-not-found' };
    }

    const chatInfo = await ctx.telegram.getChat(chatId);

    if ('linked_chat_id' in chatInfo && chatInfo.linked_chat_id) {
      await this.channelRepository.update(
        { id: channel.id },
        { discussion_group_id: chatInfo.linked_chat_id },
      );
    }

    this.logger.debug(
      `Channel upserted/retrieved: telegram_chat_id=${chatId}, id=${channel.id}, username=${channel.username}`,
    );

    // 5) Связь user <-> channel
    const isAdmin =
      member.status === 'creator' || member.status === 'administrator';

    await this.userChannelRepository.upsert(
      {
        user: { id: user.id },
        channel: { id: channel.id },
        is_admin: isAdmin,
      },
      {
        conflictPaths: ['user', 'channel'],
      },
    );
    this.logger.debug(
      `UserChannel upserted: user_id=${user.id}, channel_id=${channel.id}, is_admin=${isAdmin}`,
    );

    this.logger.log(
      `Channel ${chatId} successfully linked by user ${actorId} with role "${member.status}".`,
    );

    return {
      type: 'linked',
      data: {
        userId: user.id,
        channelId: channel.id,
        actorTelegramId: actorId,
        channelTitle: chat.title ?? null,
      },
    };
  }

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
}
