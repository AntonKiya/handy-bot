import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramCoreService } from '../../../telegram-core/telegram-core.service';
import { Api } from 'telegram';
import {
  CoreChannelUsersRunEntity,
  CoreChannelUsersRunStatus,
} from './core-channel-users-run.entity';

export interface CoreUserReportItem {
  telegramUserId: number;
  username: string | null;
  commentsCount: number;
  postsCount: number;
  avgCommentsPerActivePost: number;
}

export type CoreChannelUsersReportResult = {
  type: 'ok' | 'no-data';
  // пока оставляем поле как есть (в коммитах 7–8 может поменяться/исчезнуть)
  syncedWithTelegram: boolean;
  items: CoreUserReportItem[];
  windowFrom: Date;
  windowTo: Date;
};

export type CoreChannelUsersImmediateRunResult =
  | { type: 'limited'; message: string; nextAllowedAt: Date }
  | { type: 'already-running'; message: string }
  | { type: 'success'; report: CoreChannelUsersReportResult; runId: string }
  | { type: 'error'; message: string };

class CoreChannelUsersValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreChannelUsersValidationError';
  }
}

@Injectable()
export class CoreChannelUsersService {
  private readonly logger = new Logger(CoreChannelUsersService.name);

  // Коммит 5: лимит по user_id
  private readonly USER_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
  // Защита от дублей: если последний run=running и "свежий" — считаем уже запущено
  private readonly RUNNING_FRESH_MS = 20 * 60 * 1000;

  constructor(
    @InjectRepository(CoreChannelUsersRunEntity)
    private readonly runRepo: Repository<CoreChannelUsersRunEntity>,
    private readonly telegramCoreService: TelegramCoreService,
  ) {}

  /**
   * Коммит 6:
   * - Валидация канала и наличия discussion group делается через Core API (GramJS)
   * - НЕ используем Bot API getChat и НЕ используем channels/channel_posts/comments таблицы
   *
   * Коммит 5:
   * - check-limit: 1 раз / 24 часа на user_id (по последнему run: max created_at)
   * - запись run: running -> success/failed
   */
  async runImmediateCoreUsersReport(params: {
    userId: number;
    channelUsernameWithAt: string; // "@channel"
    period: string; // "14d" | "90d"
    windowDays: number;
  }): Promise<CoreChannelUsersImmediateRunResult> {
    const { userId, channelUsernameWithAt, period, windowDays } = params;

    const limitCheck = await this.checkImmediateLimitByUser(userId);
    if (limitCheck.type !== 'ok') {
      return limitCheck;
    }

    let validated: {
      channelId: string;
      channelUsernameWithAt: string; // canonical @username из Core
      discussionGroupId: string;
    };

    try {
      validated = await this.validateChannelAndDiscussionGroup(
        channelUsernameWithAt,
      );
    } catch (e: any) {
      const message =
        e instanceof CoreChannelUsersValidationError
          ? e.message
          : `❌ Не удалось проверить канал через Telegram Core API. Попробуйте позже.`;

      if (!(e instanceof CoreChannelUsersValidationError)) {
        this.logger.error(
          `validateChannelAndDiscussionGroup failed for ${channelUsernameWithAt}`,
          e,
        );
      }

      // ВАЖНО: на валидационных ошибках run НЕ создаём (не сжигаем лимит)
      return { type: 'error', message };
    }

    const now = new Date();

    const run = this.runRepo.create({
      userId: String(userId),
      channelTelegramChatId: String(validated.channelId),
      channelUsername: String(validated.channelUsernameWithAt),
      period: String(period),
      startedAt: now,
      status: CoreChannelUsersRunStatus.Running,
      error: null,
    });

    let savedRun: CoreChannelUsersRunEntity;
    try {
      savedRun = await this.runRepo.save(run);
    } catch (e: any) {
      this.logger.error('Failed to create core_channel_users_runs record', e);
      return {
        type: 'error',
        message: 'Не удалось запустить генерацию отчёта. Попробуйте позже.',
      };
    }

    try {
      // Коммиты 7–8: здесь будет реальный сбор комментариев из discussion group и агрегация.
      // Сейчас (Коммит 6) возвращаем безопасный "no-data" репорт, но run завершаем success,
      // чтобы работали лимиты и статусная модель.
      const report = this.buildEmptyReport(windowDays, true);

      await this.runRepo.update(savedRun.id, {
        status: CoreChannelUsersRunStatus.Success,
        error: null,
      });

      return { type: 'success', report, runId: savedRun.id };
    } catch (e: any) {
      this.logger.error(
        `Core users report failed for userId=${userId}, channel=${validated.channelUsernameWithAt}, period=${period}`,
        e,
      );

      try {
        await this.runRepo.update(savedRun.id, {
          status: CoreChannelUsersRunStatus.Failed,
          error: this.safeErrorText(e),
        });
      } catch (updateErr: any) {
        this.logger.error('Failed to update run status=failed', updateErr);
      }

      return {
        type: 'error',
        message: 'Не удалось сформировать отчёт. Попробуйте позже.',
      };
    }
  }

  /**
   * Коммит 6 — Core API валидация:
   * - формат @username
   * - getEntity(@username)
   * - это именно канал (broadcast=true), а не группа
   * - у канала есть username
   * - у канала есть linked discussion group (linked_chat_id)
   */
  private async validateChannelAndDiscussionGroup(
    channelUsernameWithAt: string,
  ): Promise<{
    channelId: string;
    channelUsernameWithAt: string;
    discussionGroupId: string;
  }> {
    const raw = (channelUsernameWithAt ?? '').trim();

    if (!raw || !raw.startsWith('@') || raw.length < 2) {
      throw new CoreChannelUsersValidationError(
        '⚠️ Пожалуйста, отправьте @channel_name (например: @my_channel).',
      );
    }

    // минимальная защита от "пробелов/ссылок"
    if (raw.includes(' ') || raw.includes('/')) {
      throw new CoreChannelUsersValidationError(
        '⚠️ Некорректный формат. Отправьте именно @channel_name (без ссылок и пробелов).',
      );
    }

    const client = await this.telegramCoreService.getClient();

    let entity: any;
    try {
      entity = await client.getEntity(raw);
    } catch (e: any) {
      // частые ошибки: USERNAME_NOT_OCCUPIED / USERNAME_INVALID / CHANNEL_PRIVATE и т.п.
      throw new CoreChannelUsersValidationError(
        `❌ Не удалось найти ${raw} или нет доступа.\n\n` +
          `Убедитесь, что это публичный канал с @username, и попробуйте снова.`,
      );
    }

    // В GramJS и публичные каналы, и публичные группы часто бывают Api.Channel.
    // Отличаем по флагу broadcast: true => канал, false => группа/megagroup.
    if (!(entity instanceof Api.Channel)) {
      throw new CoreChannelUsersValidationError(
        `⚠️ ${raw} — это не канал.\n\n` +
          `Пожалуйста, отправьте @username именно публичного канала.`,
      );
    }

    const isBroadcast = Boolean((entity as any).broadcast);
    if (!isBroadcast) {
      throw new CoreChannelUsersValidationError(
        `⚠️ ${raw} — это не канал (похоже на группу).\n\n` +
          `Пожалуйста, отправьте @username именно публичного канала.`,
      );
    }

    const username = (entity as any).username as string | undefined;
    if (!username) {
      throw new CoreChannelUsersValidationError(
        `⚠️ Канал найден, но у него нет @username.\n\n` +
          `В MVP поддерживаются только публичные каналы с @username. Попробуйте другой канал.`,
      );
    }

    // Получаем full info, чтобы достать linked_chat_id (discussion group)
    let full: any;
    try {
      const input = await client.getInputEntity(entity);
      full = await client.invoke(
        new Api.channels.GetFullChannel({ channel: input }),
      );
    } catch (e: any) {
      this.logger.error(`GetFullChannel failed for ${raw}`, e);
      throw new CoreChannelUsersValidationError(
        `❌ Не удалось получить расширенную информацию о канале ${raw}. Попробуйте позже.`,
      );
    }

    const fullChat = (full as any)?.fullChat;
    const linkedChatId =
      fullChat?.linkedChatId ?? fullChat?.linked_chat_id ?? null;

    if (!linkedChatId) {
      throw new CoreChannelUsersValidationError(
        `⚠️ У канала ${raw} нет подключённой дискуссионной группы.\n\n` +
          `Включите комментарии (discussion group) в настройках канала и попробуйте снова.`,
      );
    }

    const channelIdRaw = (entity as any).id;
    if (!channelIdRaw) {
      throw new CoreChannelUsersValidationError(
        `❌ Не удалось определить ID канала ${raw}. Попробуйте другой канал.`,
      );
    }

    return {
      channelId: String(channelIdRaw),
      channelUsernameWithAt: `@${username}`,
      discussionGroupId: String(linkedChatId),
    };
  }

  private buildEmptyReport(
    windowDays: number,
    syncedWithTelegram: boolean,
  ): CoreChannelUsersReportResult {
    const now = new Date();
    const windowTo = now;
    const windowFrom = new Date(
      now.getTime() - windowDays * 24 * 60 * 60 * 1000,
    );

    return {
      type: 'no-data',
      syncedWithTelegram,
      items: [],
      windowFrom,
      windowTo,
    };
  }

  private async checkImmediateLimitByUser(
    userId: number,
  ): Promise<
    | { type: 'ok' }
    | Extract<
        CoreChannelUsersImmediateRunResult,
        { type: 'limited' | 'already-running' }
      >
  > {
    const last = await this.runRepo.findOne({
      where: { userId: String(userId) },
      order: { createdAt: 'DESC' }, // строго по ТЗ: max created_at
    });

    if (!last) return { type: 'ok' };

    const nowMs = Date.now();
    const lastCreatedMs = last.createdAt?.getTime?.() ?? 0;

    // "already running" (fresh)
    if (
      last.status === CoreChannelUsersRunStatus.Running &&
      lastCreatedMs > 0 &&
      nowMs - lastCreatedMs < this.RUNNING_FRESH_MS
    ) {
      return {
        type: 'already-running',
        message:
          '⏳ Отчёт уже формируется. Подождите немного и попробуйте снова.',
      };
    }

    const nextAllowedAt = new Date(lastCreatedMs + this.USER_LIMIT_WINDOW_MS);

    // строго по ТЗ: если now < next_allowed_at и last.status != failed → limited
    if (
      nowMs < nextAllowedAt.getTime() &&
      last.status !== CoreChannelUsersRunStatus.Failed
    ) {
      const remainingMs = nextAllowedAt.getTime() - nowMs;
      const wait = this.formatDuration(remainingMs);

      return {
        type: 'limited',
        nextAllowedAt,
        message:
          `⚠️ Отчёт можно генерировать только 1 раз в 24 часа (на пользователя).\n\n` +
          `Попробуйте снова через ${wait}.`,
      };
    }

    return { type: 'ok' };
  }

  private formatDuration(ms: number): string {
    const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h <= 0) return `${m}м`;
    if (m === 0) return `${h}ч`;
    return `${h}ч ${m}м`;
  }

  private safeErrorText(e: any): string {
    const desc = e?.response?.description || e?.description || e?.message || '';
    const s = typeof desc === 'string' ? desc : 'unknown error';
    return s.slice(0, 2000);
  }
}
