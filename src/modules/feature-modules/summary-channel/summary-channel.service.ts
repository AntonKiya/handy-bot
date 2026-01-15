// src/telegram-bot/features/summary-channel/summary-channel.service.ts

import { Injectable, Inject, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Telegraf } from 'telegraf';

import {
  SummaryChannelAiService,
  SummaryInputMap,
  AiSummaryItem,
} from './summary-channel-ai.service';
import {
  SummaryChannelRunEntity,
  SummaryChannelRunStatus,
} from './summary-channel-run.entity';
import { SummaryChannelResultEntity } from './summary-channel-result.entity';
import {
  UserChannel,
  UserChannelFeature,
} from '../../core-modules/user-channels/user-channel.entity';

export interface ParsedChannelPost {
  id: number;
  text: string;
  date?: Date;
}

type ImmediateRunResult =
  | { type: 'limited'; message: string }
  | { type: 'empty'; message: string }
  | { type: 'success'; messages: string[]; nextSummaryAt: Date }
  | { type: 'error'; message: string };

type PlannedTarget = {
  userId: string; // telegram user id (bigint-string)
  channelTelegramChatId: string; // channel telegram_chat_id (bigint-string)
  channelUsername: string; // without @
};

type SummaryItemForDigest = {
  id: number;
  summary: string; // '' если status != ok
  status: 'ok' | 'skipped' | 'error';
  reason?: string | null;
};

@Injectable()
export class SummaryChannelService {
  private readonly logger = new Logger(SummaryChannelService.name);

  private readonly HOURS_WINDOW = 24;
  private readonly LLM_BATCH_SIZE = 10;
  private readonly SHORT_WORDS_THRESHOLD = 10;

  constructor(
    private readonly summaryChannelAiService: SummaryChannelAiService,

    @InjectRepository(SummaryChannelRunEntity)
    private readonly summaryChannelRunRepository: Repository<SummaryChannelRunEntity>,

    @InjectRepository(SummaryChannelResultEntity)
    private readonly summaryChannelResultRepository: Repository<SummaryChannelResultEntity>,

    @InjectRepository(UserChannel)
    private readonly userChannelRepository: Repository<UserChannel>,

    @Inject('TELEGRAF_BOT')
    private readonly bot: Telegraf,
  ) {}

  /**
   * Плановый запуск для всех пользователей, у кого подключён канал к SUMMARY_CHANNEL.
   * Важно: cron вызывает только этот метод.
   */
  async runPlannedSummaries(): Promise<void> {
    const targets = await this.getPlannedTargets();
    this.logger.log(`Planned summaries targets: ${targets.length}`);

    for (const t of targets) {
      try {
        await this.runPlannedSummaryForTarget(t);
      } catch (e: any) {
        this.logger.error(
          `Planned summary failed for userId=${t.userId}, channel=@${t.channelUsername}`,
          e,
        );
      }
    }
  }

  /**
   * - лимит immediate 1 раз / 24 часа
   * - запись summary_channel_runs + summary_channel_results
   *
   * Важно: этот метод возвращает готовые тексты для отправки пользователю,
   * а Flow решает КАК отправлять.
   */
  async runImmediateSummary(params: {
    userId: number;
    channelTelegramChatId: string; // bigint-string (например "-100123...")
    channelUsernameWithAt: string; // "@name"
    channelUsername: string; // "name" (без @) — нужен для ссылок t.me/name/postId
  }): Promise<ImmediateRunResult> {
    const {
      userId,
      channelTelegramChatId,
      channelUsernameWithAt,
      channelUsername,
    } = params;

    const limitCheck = await this.checkImmediateLimit(userId);
    if (limitCheck.type === 'limited') return limitCheck;

    const run = this.summaryChannelRunRepository.create({
      userId: String(userId),
      channelTelegramChatId: String(channelTelegramChatId),
      isImmediateRun: true,
      startedAt: new Date(),
      status: SummaryChannelRunStatus.Running,
      error: null,
    });

    let savedRun: SummaryChannelRunEntity;
    try {
      savedRun = await this.summaryChannelRunRepository.save(run);
    } catch (e: any) {
      this.logger.error('Failed to create summary_channel_runs record', e);
      return {
        type: 'error',
        message: 'Не удалось запустить генерацию саммари. Попробуйте позже.',
      };
    }

    try {
      const posts = await this.fetchRecentTextPostsForChannel(
        channelUsernameWithAt,
      );

      if (!posts.length) {
        await this.summaryChannelRunRepository.update(savedRun.id, {
          status: SummaryChannelRunStatus.Success,
          error: null,
        });

        return {
          type: 'empty',
          message: `В канале ${channelUsernameWithAt} сегодня без обновлений.`,
        };
      }

      const { summaries, resultsToStore } =
        await this.summarizeAndPrepareResults(
          posts,
          savedRun.id,
          channelUsername,
        );

      if (resultsToStore.length) {
        await this.summaryChannelResultRepository.insert(resultsToStore);
      }

      await this.summaryChannelRunRepository.update(savedRun.id, {
        status: SummaryChannelRunStatus.Success,
        error: null,
      });

      const digestText = this.buildDigestMessage({
        channelUsernameWithAt,
        channelUsername,
        summaries,
      });

      const nextSummaryAt = new Date(
        Date.now() + this.HOURS_WINDOW * 60 * 60 * 1000,
      );

      return {
        type: 'success',
        messages: this.splitTelegramMessage(digestText),
        nextSummaryAt,
      };
    } catch (e: any) {
      this.logger.error(
        `Immediate summary failed for ${channelUsernameWithAt}`,
        e,
      );

      try {
        await this.summaryChannelRunRepository.update(savedRun.id, {
          status: SummaryChannelRunStatus.Failed,
          error: this.safeErrorText(e),
        });
      } catch (updateErr) {
        this.logger.error(
          'Failed to update run status to failed',
          updateErr as any,
        );
      }

      return {
        type: 'error',
        message: `Failed to retrieve post summaries for ${channelUsernameWithAt}. Please try again later.`,
      };
    }
  }

  private async runPlannedSummaryForTarget(
    target: PlannedTarget,
  ): Promise<void> {
    const userId = String(target.userId);
    const channelTelegramChatId = String(target.channelTelegramChatId);

    const usernameNoAt = this.normalizeUsernameNoAt(target.channelUsername);
    if (!usernameNoAt) {
      this.logger.warn(
        `Skip planned run: empty channel username for userId=${userId}, channelTelegramChatId=${channelTelegramChatId}`,
      );
      return;
    }

    const channelUsernameWithAt = `@${usernameNoAt}`;

    const skip = await this.shouldSkipPlannedRun({
      userId,
      channelTelegramChatId,
    });
    if (skip) return;

    const run = this.summaryChannelRunRepository.create({
      userId,
      channelTelegramChatId,
      isImmediateRun: false,
      startedAt: new Date(),
      status: SummaryChannelRunStatus.Running,
      error: null,
    });

    let savedRun: SummaryChannelRunEntity;
    try {
      savedRun = await this.summaryChannelRunRepository.save(run);
    } catch (e: any) {
      this.logger.error(
        `Failed to create planned summary_channel_runs record for userId=${userId}, channel=${channelUsernameWithAt}`,
        e,
      );
      return;
    }

    try {
      const posts = await this.fetchRecentTextPostsForChannel(
        channelUsernameWithAt,
      );

      if (!posts.length) {
        await this.sendDigestToUser(
          userId,
          `В канале ${channelUsernameWithAt} сегодня без обновлений.`,
        );

        await this.summaryChannelRunRepository.update(savedRun.id, {
          status: SummaryChannelRunStatus.Success,
          error: null,
        });
        return;
      }

      const { summaries, resultsToStore } =
        await this.summarizeAndPrepareResults(posts, savedRun.id, usernameNoAt);

      if (resultsToStore.length) {
        await this.summaryChannelResultRepository.insert(resultsToStore);
      }

      const digestText = this.buildDigestMessage({
        channelUsernameWithAt,
        channelUsername: usernameNoAt,
        summaries,
      });

      await this.sendDigestToUser(userId, digestText);

      await this.summaryChannelRunRepository.update(savedRun.id, {
        status: SummaryChannelRunStatus.Success,
        error: null,
      });
    } catch (e: any) {
      this.logger.error(
        `Planned summary failed for userId=${userId}, channel=${channelUsernameWithAt}`,
        e,
      );

      try {
        await this.summaryChannelRunRepository.update(savedRun.id, {
          status: SummaryChannelRunStatus.Failed,
          error: this.safeErrorText(e),
        });
      } catch (updateErr) {
        this.logger.error(
          'Failed to update planned run status to failed',
          updateErr as any,
        );
      }
    }
  }

  private async shouldSkipPlannedRun(params: {
    userId: string;
    channelTelegramChatId: string;
  }): Promise<boolean> {
    const { userId, channelTelegramChatId } = params;

    const running = await this.summaryChannelRunRepository.findOne({
      where: {
        userId: String(userId),
        channelTelegramChatId: String(channelTelegramChatId),
        isImmediateRun: false,
        status: SummaryChannelRunStatus.Running,
      },
      order: { startedAt: 'DESC' },
    });
    if (running) return true;

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentSuccess = await this.summaryChannelRunRepository
      .createQueryBuilder('r')
      .where('r.userId = :userId', { userId: String(userId) })
      .andWhere('r.channelTelegramChatId = :channelTelegramChatId', {
        channelTelegramChatId: String(channelTelegramChatId),
      })
      .andWhere('r.isImmediateRun = false')
      .andWhere('r.status = :status', {
        status: SummaryChannelRunStatus.Success,
      })
      .andWhere('r.startedAt >= :cutoff', { cutoff })
      .orderBy('r.startedAt', 'DESC')
      .getOne();

    return !!recentSuccess;
  }

  private async getPlannedTargets(): Promise<PlannedTarget[]> {
    const rows = await this.userChannelRepository
      .createQueryBuilder('uc')
      .innerJoin('uc.user', 'u')
      .innerJoin('uc.channel', 'c')
      .select('u.telegram_user_id', 'userId')
      .addSelect('c.telegram_chat_id', 'channelTelegramChatId')
      .addSelect('c.username', 'channelUsername')
      .where('uc.feature = :feature', {
        feature: UserChannelFeature.SUMMARY_CHANNEL,
      })
      .andWhere('uc.deleted_at IS NULL')
      .andWhere('c.username IS NOT NULL')
      .getRawMany<{
        userId: string | number;
        channelTelegramChatId: string | number;
        channelUsername: string | null;
      }>();

    return rows
      .filter((r) => !!r.channelUsername)
      .map((r) => ({
        userId: String(r.userId),
        channelTelegramChatId: String(r.channelTelegramChatId),
        channelUsername: this.normalizeUsernameNoAt(String(r.channelUsername)),
      }));
  }

  private async sendDigestToUser(
    userId: string,
    digestHtml: string,
  ): Promise<void> {
    const chunks = this.splitTelegramMessage(digestHtml);

    for (const chunk of chunks) {
      await this.bot.telegram.sendMessage(String(userId), chunk, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      } as any);
    }
  }

  private async checkImmediateLimit(
    userId: number,
  ): Promise<
    Extract<ImmediateRunResult, { type: 'limited' }> | { type: 'ok' }
  > {
    const running = await this.summaryChannelRunRepository.findOne({
      where: {
        userId: String(userId),
        isImmediateRun: true,
        status: SummaryChannelRunStatus.Running,
      },
      order: { createdAt: 'DESC' },
    });

    if (running) {
      return {
        type: 'limited',
        message:
          '⏳ Генерация саммари уже запущена. Подождите немного и попробуйте снова.',
      };
    }

    const lastSuccess = await this.summaryChannelRunRepository.findOne({
      where: {
        userId: String(userId),
        isImmediateRun: true,
        status: SummaryChannelRunStatus.Success,
      },
      order: { createdAt: 'DESC' },
    });

    if (!lastSuccess) return { type: 'ok' };

    const WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const last = lastSuccess.createdAt?.getTime?.() ?? 0;

    if (now - last >= WINDOW_MS) return { type: 'ok' };

    const remainingMs = WINDOW_MS - (now - last);
    const nextAllowedAt = new Date(now + remainingMs);
    const wait = this.formatDuration(remainingMs);
    const nextAllowedStr = this.formatDateTime(nextAllowedAt);

    return {
      type: 'limited',
      message:
        `⚠️ Немедленную генерацию можно запускать только 1 раз в 24 часа.\n\n` +
        `Следующая попытка доступна: ${nextAllowedStr}\n` +
        `Попробуйте снова через ${wait}.`,
    };
  }

  /**
   * Шаг 5:
   * - если в посте <10 слов → status=ok, summary=original (AI не вызываем)
   * - LLM вызываем батчами по 15 постов
   * - сохраняем original + summary_text + status + reason + post_url в results
   *
   * Правило: если status != ok → summaryText = ''
   */
  private async summarizeAndPrepareResults(
    posts: ParsedChannelPost[],
    runId: string,
    channelUsername: string,
  ): Promise<{
    summaries: SummaryItemForDigest[];
    resultsToStore: Array<Partial<SummaryChannelResultEntity>>;
  }> {
    const needAi: ParsedChannelPost[] = [];
    const forcedSummaries: Record<string, { status: 'ok'; summary: string }> =
      {};

    for (const p of posts) {
      const original = this.normalizeOneLine(p.text);
      const wc = this.countWords(original);

      if (wc > 0 && wc < this.SHORT_WORDS_THRESHOLD) {
        forcedSummaries[String(p.id)] = { status: 'ok', summary: original };
      } else {
        needAi.push({ ...p, text: original });
      }
    }

    const aiResults: Record<
      string,
      { status: 'ok' | 'skipped' | 'error'; summary: string; reason?: string }
    > = {};

    const batches = this.chunkArray(needAi, this.LLM_BATCH_SIZE);

    for (const batch of batches) {
      const inputMap: SummaryInputMap = {};
      for (const p of batch) {
        inputMap[String(p.id)] = p.text;
      }

      try {
        const batchItems: AiSummaryItem[] =
          await this.summaryChannelAiService.summarizePosts(inputMap);

        for (const item of batchItems) {
          const id = String(item?.id ?? '').trim();
          if (!id) continue;

          const status: 'ok' | 'skipped' | 'error' =
            item.status === 'skipped' || item.status === 'error'
              ? item.status
              : 'ok';

          const reason = item.reason
            ? this.normalizeOneLine(item.reason)
            : undefined;

          const summary =
            status === 'ok' ? this.normalizeOneLine(item.summary ?? '') : '';

          aiResults[id] = { status, summary, reason };
        }
      } catch (e) {
        this.logger.error(
          `LLM batch failed (size=${batch.length}), will fallback to snippets for these posts`,
          e as any,
        );
      }
    }

    const summaries: SummaryItemForDigest[] = [];
    const resultsToStore: Array<Partial<SummaryChannelResultEntity>> = [];

    for (const p of posts) {
      const key = String(p.id);
      const original = this.normalizeOneLine(p.text);

      const forced = forcedSummaries[key];
      const fromAi = aiResults[key];

      let status: 'ok' | 'skipped' | 'error' = 'ok';
      let reason: string | null = null;
      let summaryText = '';

      if (forced) {
        status = 'ok';
        summaryText = forced.summary;
      } else if (fromAi) {
        status = fromAi.status;
        reason = fromAi.reason ?? null;
        summaryText = fromAi.status === 'ok' ? fromAi.summary : '';
      } else {
        // fallback: AI не вернул item по этому id / батч упал
        status = 'ok';
        summaryText = original.slice(0, 120).trim();
      }

      if (status !== 'ok') summaryText = '';

      const postUrl = `https://t.me/${channelUsername}/${p.id}`;

      summaries.push({
        id: p.id,
        summary: summaryText,
        status,
        reason,
      });

      resultsToStore.push({
        runId,
        telegramPostId: p.id,
        originalText: original,
        summaryText: summaryText,
        status,
        reason,
        postUrl,
      });
    }

    return { summaries, resultsToStore };
  }

  private buildDigestMessage(params: {
    channelUsernameWithAt: string;
    channelUsername: string; // без @
    summaries: SummaryItemForDigest[];
  }): string {
    const { channelUsernameWithAt, channelUsername, summaries } = params;

    const title = `<b>Саммари за последние ${this.HOURS_WINDOW}ч</b>: ${this.escapeHtml(
      channelUsernameWithAt,
    )}`;

    const blocks = summaries.map((item, idx) => {
      const url = `https://t.me/${channelUsername}/${item.id}`;

      const text =
        item.status === 'ok'
          ? this.escapeHtml(this.normalizeOneLine(item.summary))
          : this.escapeHtml(this.normalizeOneLine(item.reason ?? '—'));

      return `${idx + 1}. ${text}\n<a href="${url}">К оригинальному посту →</a>`;
    });

    return `${title}\n\n${blocks.join('\n\n')}`;
  }

  async fetchRecentTextPostsForChannel(
    channelNameWithAt: string,
  ): Promise<ParsedChannelPost[]> {
    const cutoff = Date.now() - this.HOURS_WINDOW * 60 * 60 * 1000;

    const channelSlug = channelNameWithAt.replace(/^@/, '');
    let before: number | undefined;
    const result: ParsedChannelPost[] = [];
    const seenPostIds = new Set<number>();

    const MAX_PAGES = 20;
    let page = 0;

    while (page < MAX_PAGES) {
      page++;

      const url = before
        ? `https://t.me/s/${channelSlug}?before=${before}`
        : `https://t.me/s/${channelSlug}`;

      this.logger.debug(`Fetching channel HTML: ${url}`);

      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(
          `Failed to fetch channel "${channelSlug}", status: ${res.status}`,
        );
        break;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const messages = $('.tgme_widget_message');
      if (!messages.length) {
        this.logger.debug(
          `No messages found on page ${page} for channel ${channelSlug}`,
        );
        break;
      }

      let oldestDateOnPage: Date | undefined;
      const idsOnPage: number[] = [];

      messages.each((_, el) => {
        const msg = $(el);
        const dataPost = msg.attr('data-post');
        if (!dataPost) return;

        const [, idStr] = dataPost.split('/');
        const id = Number(idStr);
        if (!Number.isFinite(id)) return;
        idsOnPage.push(id);

        const timeEl = msg.find('.tgme_widget_message_date time');
        const datetime = timeEl.attr('datetime');
        let date: Date | undefined;

        if (datetime) {
          date = new Date(datetime);
          if (
            !oldestDateOnPage ||
            (date && date.getTime() < oldestDateOnPage.getTime())
          ) {
            oldestDateOnPage = date;
          }
        }

        if (date && date.getTime() < cutoff) return;

        const textEl = msg
          .find('.tgme_widget_message_text.js-message_text')
          .first();

        const text = textEl.text().trim();
        if (!text) return;

        if (!date || date.getTime() >= cutoff) {
          if (!seenPostIds.has(id)) {
            seenPostIds.add(id);
            result.push({ id, text, date });
          }
        }
      });

      if (!idsOnPage.length) break;

      before = Math.min(...idsOnPage);

      if (oldestDateOnPage && oldestDateOnPage.getTime() < cutoff) break;
    }

    if (page >= MAX_PAGES) {
      const oldestDate = result
        .map((p) => p.date)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      if (!oldestDate || oldestDate.getTime() >= cutoff) {
        this.logger.warn(
          `Reached MAX_PAGES=${MAX_PAGES} for channel ${channelSlug}, but still did not reach cutoff for last ${this.HOURS_WINDOW}h. Result may be incomplete.`,
        );
      }
    }

    result.sort((a, b) => {
      const at = a.date ? a.date.getTime() : Number.POSITIVE_INFINITY;
      const bt = b.date ? b.date.getTime() : Number.POSITIVE_INFINITY;
      return at - bt;
    });

    this.logger.debug(
      `Fetched ${result.length} text posts for channel ${channelSlug} (last ${this.HOURS_WINDOW}h)`,
    );

    return result;
  }

  /**
   * Оставляем как было — может использоваться в других местах.
   * Но Flow теперь должен использовать runImmediateSummary().
   *
   * Правило: status != ok → summary = ''
   */
  async getRecentPostSummariesForChannel(
    channelNameWithAt: string,
  ): Promise<{ id: number; summary: string }[]> {
    const posts = await this.fetchRecentTextPostsForChannel(channelNameWithAt);

    if (!posts.length) {
      this.logger.debug(
        `No recent posts found for channel ${channelNameWithAt}`,
      );
      return [];
    }

    const inputMap: SummaryInputMap = {};
    for (const p of posts) {
      inputMap[String(p.id)] = p.text;
    }

    let items: AiSummaryItem[] = [];
    try {
      items = await this.summaryChannelAiService.summarizePosts(inputMap);
    } catch (e) {
      this.logger.error(
        `Failed to summarize posts for channel ${channelNameWithAt}, fallback to raw text snippets`,
        e as any,
      );
      return posts.map((p) => ({
        id: p.id,
        summary: p.text.slice(0, 120),
      }));
    }

    const map: Record<string, AiSummaryItem> = {};
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it?.id) map[String(it.id)] = it;
      }
    }

    return posts.map((p) => {
      const key = String(p.id);
      const item = map[key];
      const status = item?.status ?? 'ok';

      const summary =
        status === 'ok' ? this.normalizeOneLine(item?.summary ?? '') : '';

      return { id: p.id, summary };
    });
  }

  private normalizeUsernameNoAt(username: string): string {
    const raw = (username ?? '').trim();
    if (!raw) return '';
    return raw.startsWith('@') ? raw.slice(1) : raw;
  }

  private countWords(text: string): number {
    const t = this.normalizeOneLine(text);
    if (!t) return 0;
    return t
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean).length;
  }

  private normalizeOneLine(text: string): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const n = Math.max(1, size | 0);
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) {
      out.push(arr.slice(i, i + n));
    }
    return out;
  }

  private formatDuration(ms: number): string {
    const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h <= 0) return `${m}м`;
    if (m === 0) return `${h}ч`;
    return `${h}ч ${m}м`;
  }

  private formatDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  private safeErrorText(e: any): string {
    const desc = e?.response?.description || e?.description || e?.message || '';
    const s = typeof desc === 'string' ? desc : 'unknown error';
    return s.slice(0, 2000);
  }

  private splitTelegramMessage(text: string, maxLen = 3500): string[] {
    const t = (text ?? '').trim();
    if (!t) return [''];

    if (t.length <= maxLen) return [t];

    const parts = t.split('\n\n');
    const chunks: string[] = [];

    let current = '';
    for (const p of parts) {
      const candidate = current ? `${current}\n\n${p}` : p;
      if (candidate.length <= maxLen) {
        current = candidate;
        continue;
      }

      if (current) chunks.push(current);
      current = p;

      while (current.length > maxLen) {
        chunks.push(current.slice(0, maxLen));
        current = current.slice(maxLen);
      }
    }

    if (current) chunks.push(current);
    return chunks.filter((c) => c.trim().length > 0);
  }

  private escapeHtml(text: string): string {
    return (text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
