import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

export type TelegramAccessError =
  | 'BOT_NOT_ADMIN_IN_CHANNEL'
  | 'NO_DISCUSSION_GROUP'
  | 'BOT_NOT_ADMIN_IN_DISCUSSION_GROUP'
  | 'USER_NOT_ADMIN_IN_CHANNEL'
  | 'TELEGRAM_API_ERROR';

export type TelegramAccessResult =
  | { ok: true }
  | { ok: false; error: TelegramAccessError; details?: string };

@Injectable()
export class TelegramAccessVerifierService {
  private botId: number | null = null;

  private async getBotId(telegram: Context['telegram']): Promise<number> {
    if (this.botId) {
      return this.botId;
    }

    const me = await telegram.getMe();
    this.botId = me.id;
    return this.botId;
  }

  private isAdminStatus(status?: string): boolean {
    return status === 'administrator' || status === 'creator';
  }

  async verifyBotIsAdminInChannel(
    telegram: Context['telegram'],
    channelChatId: number,
  ): Promise<TelegramAccessResult> {
    try {
      const botId = await this.getBotId(telegram);
      const member = await telegram.getChatMember(channelChatId, botId);

      if (!this.isAdminStatus((member as any)?.status)) {
        return { ok: false, error: 'BOT_NOT_ADMIN_IN_CHANNEL' };
      }

      return { ok: true };
    } catch (e: any) {
      return {
        ok: false,
        error: 'TELEGRAM_API_ERROR',
        details: e?.message,
      };
    }
  }

  verifyChannelHasDiscussionGroup(
    discussionGroupId: number | string | null | undefined,
  ): TelegramAccessResult {
    if (!discussionGroupId) {
      return { ok: false, error: 'NO_DISCUSSION_GROUP' };
    }

    return { ok: true };
  }

  async verifyBotIsAdminInDiscussionGroup(
    telegram: Context['telegram'],
    discussionGroupChatId: number,
  ): Promise<TelegramAccessResult> {
    try {
      const botId = await this.getBotId(telegram);
      const member = await telegram.getChatMember(discussionGroupChatId, botId);

      if (!this.isAdminStatus((member as any)?.status)) {
        return { ok: false, error: 'BOT_NOT_ADMIN_IN_DISCUSSION_GROUP' };
      }

      return { ok: true };
    } catch (e: any) {
      return {
        ok: false,
        error: 'TELEGRAM_API_ERROR',
        details: e?.message,
      };
    }
  }

  async verifyUserIsAdminInChannel(
    telegram: Context['telegram'],
    channelChatId: number,
    telegramUserId: number,
  ): Promise<TelegramAccessResult> {
    try {
      const member = await telegram.getChatMember(
        channelChatId,
        telegramUserId,
      );

      if (!this.isAdminStatus((member as any)?.status)) {
        return { ok: false, error: 'USER_NOT_ADMIN_IN_CHANNEL' };
      }

      return { ok: true };
    } catch (e: any) {
      return {
        ok: false,
        error: 'TELEGRAM_API_ERROR',
        details: e?.message,
      };
    }
  }
}
