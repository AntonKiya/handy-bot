import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramCoreService } from '../../../telegram-core/telegram-core.service';
import { Api } from 'telegram';
import {
  CoreChannelUsersRunEntity,
  CoreChannelUsersRunStatus,
} from './core-channel-users-run.entity';
import {
  DISCUSSION_BATCH_LIMIT,
  MAX_DISCUSSION_MESSAGES_SCAN,
  MS_PER_DAY,
  TOP_USERS_AMOUNT,
} from './core-channel-users.constants';
import {
  extractAuthorPeerId,
  extractReplyToMsgId,
  extractThreadRootId,
  extractSenderUsername,
  tgDateToDate,
} from './core-channel-users.telegram.helpers';

export interface CoreUserReportItem {
  telegramUserId: number;
  username: string | null;
  commentsCount: number;
  postsCount: number;
  avgCommentsPerActivePost: number;
}

export type CoreChannelUsersReportResult = {
  type: 'ok' | 'no-data';
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

type ValidatedChannel = {
  channelId: string;
  channelUsernameWithAt: string;
  discussionGroupId: string;

  channelInputPeer: any;
  discussionInputPeer: any;
};

type AuthorAgg = {
  telegramUserId: number;
  username: string | null;
  commentsCount: number;
  postIds: Set<number>;
};

@Injectable()
export class CoreChannelUsersService {
  private readonly logger = new Logger(CoreChannelUsersService.name);

  private readonly USER_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
  private readonly RUNNING_FRESH_MS = 20 * 60 * 1000;

  // чтобы не утонуть в логах
  private readonly DEBUG_SAMPLE_MESSAGES = 25;
  private readonly DEBUG_SAMPLE_RESOLVES = 25;

  // важно для nested replies, когда topId отсутствует:
  // идём вверх по reply-цепочке и ищем автофорвард из канала
  private readonly MAX_REPLY_CHAIN_STEPS = 25;

  constructor(
    @InjectRepository(CoreChannelUsersRunEntity)
    private readonly runRepo: Repository<CoreChannelUsersRunEntity>,
    private readonly telegramCoreService: TelegramCoreService,
  ) {}

  async runImmediateCoreUsersReport(params: {
    userId: number;
    channelUsernameWithAt: string; // "@channel"
    period: string; // "14d" | "90d"
    windowDays: number;
  }): Promise<CoreChannelUsersImmediateRunResult> {
    const { userId, channelUsernameWithAt, period, windowDays } = params;

    const limitCheck = await this.checkImmediateLimitByUser(userId);
    if (limitCheck.type !== 'ok') return limitCheck;

    let validated: ValidatedChannel;

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

      return { type: 'error', message };
    }

    this.logger.debug(
      `[core-users] validated: channel=${validated.channelUsernameWithAt} channelId=${validated.channelId} discussionGroupId=${validated.discussionGroupId} ` +
        `channelPeer=${validated.channelInputPeer?.className ?? 'unknown'} discussionPeer=${validated.discussionInputPeer?.className ?? 'unknown'}`,
    );

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
      const report = await this.buildCoreUsersReportFromDiscussionGroup({
        validated,
        windowDays,
      });

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

  private async buildCoreUsersReportFromDiscussionGroup(params: {
    validated: ValidatedChannel;
    windowDays: number;
  }): Promise<CoreChannelUsersReportResult> {
    const { validated, windowDays } = params;

    const now = new Date();
    const windowTo = now;
    const windowFrom = new Date(now.getTime() - windowDays * MS_PER_DAY);

    const client = await this.telegramCoreService.getClient();

    // sanity — чтобы понимать, что канал читается
    try {
      const ch = await client.getMessages(validated.channelInputPeer, {
        limit: 1,
      });
      const m0 = ch?.[0] as any;
      this.logger.debug(
        `[core-users] sanity channel last: ok=${Boolean(m0)} id=${m0?.id ?? 'n/a'} date=${m0?.date ? tgDateToDate(m0.date).toISOString() : 'n/a'}`,
      );
    } catch (e: any) {
      this.logger.warn(
        `[core-users] sanity channel last: FAILED (${this.safeErrorText(e)})`,
      );
    }

    // cache: messageId_in_discussion -> channelPostId (или null если не относится к посту канала)
    const msgIdToChannelPostIdCache = new Map<number, number | null>();
    const authorCache = new Map<string, { username: string | null }>();
    const agg = new Map<string, AuthorAgg>();

    let scanned = 0;
    let offsetId = 0;
    let stopByWindow = false;

    let debugMsgPrinted = 0;
    let debugResolvePrinted = 0;

    this.logger.debug(
      `[core-users] scan start: channel=${validated.channelUsernameWithAt} discussionGroupId=${validated.discussionGroupId} ` +
        `windowFrom=${windowFrom.toISOString()} windowTo=${windowTo.toISOString()} batchLimit=${DISCUSSION_BATCH_LIMIT} maxScan=${MAX_DISCUSSION_MESSAGES_SCAN}`,
    );

    while (!stopByWindow) {
      const messages = await client.getMessages(validated.discussionInputPeer, {
        limit: DISCUSSION_BATCH_LIMIT,
        offsetId,
      });

      if (!messages || messages.length === 0) break;

      const first = messages[0] as any;
      const last = messages[messages.length - 1] as any;

      this.logger.debug(
        `[core-users] batch: offsetId=${offsetId} got=${messages.length} ` +
          `firstId=${first?.id ?? 'n/a'} firstDate=${first?.date ? tgDateToDate(first.date).toISOString() : 'n/a'} ` +
          `lastId=${last?.id ?? 'n/a'} lastDate=${last?.date ? tgDateToDate(last.date).toISOString() : 'n/a'}`,
      );

      for (const m of messages) {
        const msg = m as Api.Message;
        const msgId = Number((msg as any)?.id);

        if (!msg || !Number.isFinite(msgId) || msgId <= 0) continue;

        scanned += 1;
        if (scanned > MAX_DISCUSSION_MESSAGES_SCAN) {
          this.logger.warn(
            `[core-users] scan safety stop. scanned>${MAX_DISCUSSION_MESSAGES_SCAN}`,
          );
          stopByWindow = true;
          break;
        }

        const commentedAt = tgDateToDate((msg as any).date);

        // строго по ТЗ: останавливаемся на первом сообщении старше окна
        if (commentedAt < windowFrom) {
          this.logger.debug(
            `[core-users] stopByWindow: msg#${msgId} date=${commentedAt.toISOString()} < windowFrom=${windowFrom.toISOString()}`,
          );
          stopByWindow = true;
          break;
        }

        // candidateId = replyToTopId ?? replyToMsgId
        const threadRootId = extractThreadRootId(msg);
        if (!threadRootId) {
          if (debugMsgPrinted < this.DEBUG_SAMPLE_MESSAGES) {
            const r: any = (msg as any)?.replyTo ?? null;
            const top =
              r?.replyToTopId ?? r?.topMsgId ?? r?.top ?? r?.reply_to_top_id;
            const direct =
              r?.replyToMsgId ?? r?.reply_to_msg_id ?? r?.msgId ?? r?.msg;
            this.logger.debug(
              `[core-users] msg#${msgId} date=${commentedAt.toISOString()} skip(no-reply) replyTo=${r ? `top=${top ?? 'null'}, msg=${direct ?? 'null'}` : 'null'}`,
            );
            debugMsgPrinted += 1;
          }
          continue;
        }

        const authorPeer = extractAuthorPeerId(msg);
        if (!authorPeer) continue;

        // отчёт по пользователям — считаем только user
        if (authorPeer.type !== 'user') {
          if (debugMsgPrinted < this.DEBUG_SAMPLE_MESSAGES) {
            this.logger.debug(
              `[core-users] msg#${msgId} date=${commentedAt.toISOString()} skip(author-not-user) author=${authorPeer.type}:${authorPeer.id} threadCandidate=${threadRootId}`,
            );
            debugMsgPrinted += 1;
          }
          continue;
        }

        if (debugMsgPrinted < this.DEBUG_SAMPLE_MESSAGES) {
          const r: any = (msg as any)?.replyTo ?? null;
          const top =
            r?.replyToTopId ?? r?.topMsgId ?? r?.top ?? r?.reply_to_top_id;
          const direct =
            r?.replyToMsgId ?? r?.reply_to_msg_id ?? r?.msgId ?? r?.msg;
          this.logger.debug(
            `[core-users] msg#${msgId} date=${commentedAt.toISOString()} author=user:${authorPeer.id} threadCandidate=${threadRootId} replyTo=top=${top ?? 'null'} msg=${direct ?? 'null'}`,
          );
          debugMsgPrinted += 1;
        }

        // КЛЮЧЕВО: резолвим channelPostId даже если top отсутствует
        // поднимаясь по reply-цепочке до автофорварда из канала
        const channelPostId = await this.resolveChannelPostIdByReplyChain({
          client,
          channelId: validated.channelId,
          discussionPeer: validated.discussionInputPeer,
          startMsgId: threadRootId,
          cache: msgIdToChannelPostIdCache,
          debug: debugResolvePrinted < this.DEBUG_SAMPLE_RESOLVES,
        });

        if (debugResolvePrinted < this.DEBUG_SAMPLE_RESOLVES) {
          this.logger.debug(
            `[core-users] map: start=${threadRootId} -> channelPostId=${channelPostId}`,
          );
          debugResolvePrinted += 1;
        }

        if (!channelPostId) continue;

        const authorIdStr = authorPeer.id;
        const authorIdNum = Number(authorIdStr);
        if (!Number.isFinite(authorIdNum) || authorIdNum <= 0) continue;

        // username cache
        let authorUsername: string | null = null;
        const cachedAuthor = authorCache.get(authorIdStr);
        if (cachedAuthor) {
          authorUsername = cachedAuthor.username;
        } else {
          authorUsername = await this.tryResolveSenderUsername(msg);
          authorCache.set(authorIdStr, { username: authorUsername });
        }

        const existing = agg.get(authorIdStr);
        if (!existing) {
          agg.set(authorIdStr, {
            telegramUserId: authorIdNum,
            username: authorUsername,
            commentsCount: 1,
            postIds: new Set<number>([channelPostId]),
          });
        } else {
          existing.commentsCount += 1;
          if (!existing.username && authorUsername)
            existing.username = authorUsername;
          existing.postIds.add(channelPostId);
        }
      }

      const lastMsg = messages[messages.length - 1] as any;
      const lastId = Number(lastMsg?.id);
      if (!Number.isFinite(lastId) || lastId <= 0) break;

      offsetId = lastId;

      if (messages.length < DISCUSSION_BATCH_LIMIT) break;
    }

    this.logger.debug(
      `[core-users] scan done: scanned=${scanned} uniqueAuthors=${agg.size} cachedMsgIds=${msgIdToChannelPostIdCache.size}`,
    );

    const items = Array.from(agg.values())
      .map((x) => {
        const postsCount = x.postIds.size;
        const avg = postsCount > 0 ? x.commentsCount / postsCount : 0;
        return {
          telegramUserId: x.telegramUserId,
          username: x.username,
          commentsCount: x.commentsCount,
          postsCount,
          avgCommentsPerActivePost: avg,
        } satisfies CoreUserReportItem;
      })
      .sort((a, b) => b.commentsCount - a.commentsCount)
      .slice(0, TOP_USERS_AMOUNT);

    if (!items.length) {
      return {
        type: 'no-data',
        syncedWithTelegram: true,
        items: [],
        windowFrom,
        windowTo,
      };
    }

    return {
      type: 'ok',
      syncedWithTelegram: true,
      items,
      windowFrom,
      windowTo,
    };
  }

  private async tryResolveSenderUsername(
    msg: Api.Message,
  ): Promise<string | null> {
    try {
      const sender = await (msg as any).getSender?.();
      return extractSenderUsername(sender);
    } catch {
      return null;
    }
  }

  /**
   * Ищем channelPostId по reply-цепочке:
   * startMsgId -> (fetch msg) -> если автофорвард из нужного канала => берём fwdFrom.channelPost
   * иначе -> идём выше по replyToMsgId, пока не найдём root или не упремся.
   *
   * Это закрывает кейс "ответы на ответы", когда replyToTopId отсутствует (как у тебя в логах).
   */
  private async resolveChannelPostIdByReplyChain(params: {
    client: any;
    channelId: string;
    discussionPeer: any;
    startMsgId: number;
    cache: Map<number, number | null>;
    debug: boolean;
  }): Promise<number | null> {
    const { client, channelId, discussionPeer, startMsgId, cache, debug } =
      params;

    const cached0 = cache.get(startMsgId);
    if (cached0 !== undefined) return cached0;

    const visited: number[] = [];
    let currentId: number | null = startMsgId;

    for (let step = 0; step < this.MAX_REPLY_CHAIN_STEPS; step += 1) {
      if (!currentId || currentId <= 0) {
        this.setCacheForVisited(cache, visited, null);
        return null;
      }

      const cached = cache.get(currentId);
      if (cached !== undefined) {
        this.setCacheForVisited(cache, visited, cached);
        return cached;
      }

      visited.push(currentId);

      let arr: any;
      try {
        arr = await client.getMessages(discussionPeer, { ids: [currentId] });
      } catch {
        this.setCacheForVisited(cache, visited, null);
        return null;
      }

      const rootMsg = (arr?.[0] ?? null) as any;
      if (!rootMsg || !(rootMsg instanceof Api.Message)) {
        this.setCacheForVisited(cache, visited, null);
        return null;
      }

      const fwd: any = rootMsg?.fwdFrom ?? null;
      const fromId: any = fwd?.fromId ?? fwd?.from_id ?? null;
      const channelPost = fwd?.channelPost ?? fwd?.channel_post ?? null;

      if (debug) {
        const peerId = rootMsg?.peerId;
        const peer =
          peerId instanceof Api.PeerChannel
            ? `PeerChannel:${peerId.channelId}`
            : peerId instanceof Api.PeerChat
              ? `PeerChat:${peerId.chatId}`
              : peerId instanceof Api.PeerUser
                ? `PeerUser:${peerId.userId}`
                : 'Peer:?';

        const from =
          fromId instanceof Api.PeerChannel
            ? `PeerChannel:${fromId.channelId}`
            : fromId instanceof Api.PeerChat
              ? `PeerChat:${fromId.chatId}`
              : fromId instanceof Api.PeerUser
                ? `PeerUser:${fromId.userId}`
                : fromId
                  ? 'Peer:?'
                  : 'null';

        const parent = extractReplyToMsgId(rootMsg);

        this.logger.debug(
          `[core-users] resolve-step#${step}: msgId=${currentId} peer=${peer} fwdFrom.from=${from} fwdFrom.channelPost=${channelPost ?? 'null'} parentReplyTo=${parent ?? 'null'}`,
        );
      }

      if (
        typeof channelPost === 'number' &&
        channelPost > 0 &&
        fromId instanceof Api.PeerChannel &&
        String(fromId.channelId) === String(channelId)
      ) {
        this.setCacheForVisited(cache, visited, channelPost);
        return channelPost;
      }

      // идём выше по цепочке
      const parentId = extractReplyToMsgId(rootMsg);
      if (!parentId) {
        this.setCacheForVisited(cache, visited, null);
        return null;
      }

      currentId = parentId;
    }

    // safety
    this.setCacheForVisited(cache, visited, null);
    return null;
  }

  private setCacheForVisited(
    cache: Map<number, number | null>,
    visited: number[],
    value: number | null,
  ) {
    for (const id of visited) cache.set(id, value);
  }

  private async validateChannelAndDiscussionGroup(
    channelUsernameWithAt: string,
  ): Promise<ValidatedChannel> {
    const raw = (channelUsernameWithAt ?? '').trim();

    if (!raw || !raw.startsWith('@') || raw.length < 2) {
      throw new CoreChannelUsersValidationError(
        '⚠️ Пожалуйста, отправьте @channel_name (например: @my_channel).',
      );
    }

    if (raw.includes(' ') || raw.includes('/')) {
      throw new CoreChannelUsersValidationError(
        '⚠️ Некорректный формат. Отправьте именно @channel_name (без ссылок и пробелов).',
      );
    }

    const client = await this.telegramCoreService.getClient();

    let entity: any;
    try {
      entity = await client.getEntity(raw);
    } catch {
      throw new CoreChannelUsersValidationError(
        `❌ Не удалось найти ${raw} или нет доступа.\n\n` +
          `Убедитесь, что это публичный канал с @username, и попробуйте снова.`,
      );
    }

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

    const chats: any[] = (full as any)?.chats ?? [];
    const discussionChat = chats.find(
      (c) => String((c as any)?.id) === String(linkedChatId),
    );

    if (!discussionChat) {
      throw new CoreChannelUsersValidationError(
        `❌ Не удалось получить данные дискуссионной группы для ${raw}. Попробуйте позже.`,
      );
    }

    let channelInputPeer: any;
    let discussionInputPeer: any;

    try {
      channelInputPeer = await client.getInputEntity(entity);
      discussionInputPeer = await client.getInputEntity(discussionChat);
    } catch (e: any) {
      this.logger.error(`getInputEntity failed for ${raw}`, e);
      throw new CoreChannelUsersValidationError(
        `❌ Не удалось подготовить данные для чтения комментариев ${raw}. Попробуйте позже.`,
      );
    }

    return {
      channelId: String(channelIdRaw),
      channelUsernameWithAt: `@${username}`,
      discussionGroupId: String(linkedChatId),
      channelInputPeer,
      discussionInputPeer,
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
      order: { createdAt: 'DESC' },
    });

    if (!last) return { type: 'ok' };

    const nowMs = Date.now();
    const lastCreatedMs = last.createdAt?.getTime?.() ?? 0;

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
