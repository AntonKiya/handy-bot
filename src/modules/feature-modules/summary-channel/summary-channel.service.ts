// src/telegram-bot/features/summary-channel/summary-channel.service.ts

import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { DataSource } from 'typeorm';
import {
  SummaryChannelAiService,
  SummaryInputMap,
} from './summary-channel-ai.service';
import {
  SummaryChannelRunEntity,
  SummaryChannelRunStatus,
} from './summary-channel-run.entity';
import { SummaryChannelResultEntity } from './summary-channel-result.entity';

export interface ParsedChannelPost {
  id: number;
  text: string;
  date?: Date;
}

type ImmediateRunResult =
  | { type: 'limited'; message: string }
  | { type: 'empty'; message: string }
  | { type: 'success'; messages: string[] }
  | { type: 'error'; message: string };

@Injectable()
export class SummaryChannelService {
  private readonly logger = new Logger(SummaryChannelService.name);

  constructor(
    private readonly summaryChannelAiService: SummaryChannelAiService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * - лимит immediate 1 раз / 24 часа (без next_allowed_at)
   * - запись channel_summary_runs + channel_summary_results
   *
   * Важно: этот метод возвращает готовые тексты для отправки пользователю,
   * а Flow решает КАК отправлять (reply/edit, сколько сообщений и т.д.).
   */
  async runImmediateSummary(params: {
    userId: number;
    channelTelegramChatId: string; // bigint-string (например "-100123...")
    channelUsernameWithAt: string; // "@name"
    channelUsername: string; // "name" (без @) — только для логов/текста при желании
  }): Promise<ImmediateRunResult> {
    const { userId, channelTelegramChatId, channelUsernameWithAt } = params;

    // 1) Лимит: 1 успешный immediate-run / 24 часа на пользователя
    const limitCheck = await this.checkImmediateLimit(userId);
    if (limitCheck.type === 'limited') {
      return limitCheck;
    }

    // 2) Создаём run со статусом running
    const runRepo = this.dataSource.getRepository(SummaryChannelRunEntity);
    const resultRepo = this.dataSource.getRepository(
      SummaryChannelResultEntity,
    );

    const run = runRepo.create({
      userId: String(userId),
      channelTelegramChatId: String(channelTelegramChatId),
      isImmediateRun: true,
      startedAt: new Date(),
      status: SummaryChannelRunStatus.Running,
      error: null,
    });

    let savedRun: SummaryChannelRunEntity;
    try {
      savedRun = await runRepo.save(run);
    } catch (e: any) {
      this.logger.error('Failed to create channel_summary_runs record', e);
      return {
        type: 'error',
        message: 'Не удалось запустить генерацию саммари. Попробуйте позже.',
      };
    }

    try {
      // 3) Берём посты за окно
      const posts = await this.fetchRecentTextPostsForChannel(
        channelUsernameWithAt,
      );

      if (!posts.length) {
        await runRepo.update(savedRun.id, {
          status: SummaryChannelRunStatus.Success,
          error: null,
        });

        return {
          type: 'empty',
          message: `There are no suitable text posts in the ${channelUsernameWithAt} channel for the recent period.`,
        };
      }

      // 4) Генерация саммари (как сейчас, без шага 5)
      const { summaries, resultsToStore } =
        await this.summarizeAndPrepareResults(posts, savedRun.id);

      // 5) Сохраняем results (bulk)
      if (resultsToStore.length) {
        await resultRepo.insert(resultsToStore);
      }

      // 6) Обновляем run → success
      await runRepo.update(savedRun.id, {
        status: SummaryChannelRunStatus.Success,
        error: null,
      });

      // 7) Возвращаем текст для пользователя (старый формат: "<id>: <summary>")
      const lines = summaries.map((item) => `${item.id}: ${item.summary}`);
      const messageText = lines.join('\n\n');

      return {
        type: 'success',
        messages: this.splitTelegramMessage(messageText),
      };
    } catch (e: any) {
      this.logger.error(
        `Immediate summary failed for ${channelUsernameWithAt}`,
        e,
      );

      try {
        await runRepo.update(savedRun.id, {
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

  private async checkImmediateLimit(
    userId: number,
  ): Promise<
    Extract<ImmediateRunResult, { type: 'limited' }> | { type: 'ok' }
  > {
    const runRepo = this.dataSource.getRepository(SummaryChannelRunEntity);

    // Если уже есть running immediate — не даём стартовать ещё раз
    const running = await runRepo.findOne({
      where: {
        userId: String(userId),
        isImmediateRun: true,
        status: SummaryChannelRunStatus.Running,
      },
      order: { startedAt: 'DESC' },
    });

    if (running) {
      return {
        type: 'limited',
        message:
          '⏳ Генерация саммари уже запущена. Подождите немного и попробуйте снова.',
      };
    }

    const lastSuccess = await runRepo.findOne({
      where: {
        userId: String(userId),
        isImmediateRun: true,
        status: SummaryChannelRunStatus.Success,
      },
      order: { startedAt: 'DESC' },
    });

    if (!lastSuccess) {
      return { type: 'ok' };
    }

    const WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const last = lastSuccess.startedAt?.getTime?.() ?? 0;

    if (now - last >= WINDOW_MS) {
      return { type: 'ok' };
    }

    const remainingMs = WINDOW_MS - (now - last);
    const wait = this.formatDuration(remainingMs);

    return {
      type: 'limited',
      message:
        `⚠️ Немедленную генерацию можно запускать только 1 раз в 24 часа.\n\n` +
        `Попробуйте снова через ${wait}.`,
    };
  }

  private async summarizeAndPrepareResults(
    posts: ParsedChannelPost[],
    runId: string,
  ): Promise<{
    summaries: { id: number; summary: string }[];
    resultsToStore: Array<Partial<SummaryChannelResultEntity>>;
  }> {
    const inputMap: SummaryInputMap = {};
    for (const p of posts) {
      inputMap[String(p.id)] = p.text;
    }

    let summariesMap: Record<string, string> = {};
    try {
      summariesMap =
        await this.summaryChannelAiService.summarizePosts(inputMap);
    } catch (e) {
      this.logger.error(
        `Failed to summarize posts, fallback to raw text snippets`,
        e as any,
      );
      summariesMap = {};
    }

    const summaries: { id: number; summary: string }[] = [];
    const resultsToStore: Array<Partial<SummaryChannelResultEntity>> = [];

    for (const p of posts) {
      const key = String(p.id);
      const fallback = p.text.slice(0, 120);
      const summary = (summariesMap[key] ?? fallback).trim();

      summaries.push({ id: p.id, summary });

      resultsToStore.push({
        runId,
        telegramPostId: p.id,
        originalText: p.text,
        summaryText: summary,
      });
    }

    return { summaries, resultsToStore };
  }

  async fetchRecentTextPostsForChannel(
    channelNameWithAt: string,
  ): Promise<ParsedChannelPost[]> {
    const HOURS_WINDOW = 24;
    const cutoff = Date.now() - HOURS_WINDOW * 60 * 60 * 1000;

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

        // Дата поста
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

        // Если есть дата и она старше окна, то просто пометим, что можно будет остановиться после страницы
        if (date && date.getTime() < cutoff) {
          return;
        }

        // Берём именно основной текст поста, а не текст реплая:
        // .js-message_text — основной текст,
        // .js-message_reply_text — превью цитируемого сообщения (игнорируем).
        const textEl = msg
          .find('.tgme_widget_message_text.js-message_text')
          .first();

        const text = textEl.text().trim();
        if (!text) return;

        // Фильтр по окну времени
        if (!date || date.getTime() >= cutoff) {
          if (!seenPostIds.has(id)) {
            seenPostIds.add(id);
            result.push({ id, text, date });
          }
        }
      });

      if (!idsOnPage.length) break;

      before = Math.min(...idsOnPage);

      if (oldestDateOnPage && oldestDateOnPage.getTime() < cutoff) {
        break;
      }
    }

    // Если упёрлись в лимит страниц и при этом не достигли cutoff —
    // вероятно, за 24 часа постов слишком много, и выборка может быть неполной.
    if (page >= MAX_PAGES) {
      const oldestDate = result
        .map((p) => p.date)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      if (!oldestDate || oldestDate.getTime() >= cutoff) {
        this.logger.warn(
          `Reached MAX_PAGES=${MAX_PAGES} for channel ${channelSlug}, but still did not reach cutoff for last ${HOURS_WINDOW}h. Result may be incomplete.`,
        );
      }
    }

    // Сортировка по date ASC (посты без даты — в конец)
    result.sort((a, b) => {
      const at = a.date ? a.date.getTime() : Number.POSITIVE_INFINITY;
      const bt = b.date ? b.date.getTime() : Number.POSITIVE_INFINITY;
      return at - bt;
    });

    this.logger.debug(
      `Fetched ${result.length} text posts for channel ${channelSlug} (last ${HOURS_WINDOW}h)`,
    );

    return result;
  }

  /**
   * Оставляем как было — может использоваться в других местах.
   * Но Flow теперь должен использовать runImmediateSummary().
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

    let summariesMap: Record<string, string> = {};
    try {
      summariesMap =
        await this.summaryChannelAiService.summarizePosts(inputMap);
    } catch (e) {
      this.logger.error(
        `Failed to summarize posts for channel ${channelNameWithAt}, fallback to raw text snippets`,
        e as any,
      );
      // На случай ошибки LLM возвращаем первые слова оригинала
      return posts.map((p) => ({
        id: p.id,
        summary: p.text.slice(0, 120),
      }));
    }

    return posts.map((p) => {
      const key = String(p.id);
      const summary = summariesMap[key] ?? p.text.slice(0, 120);
      return { id: p.id, summary };
    });
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

  private splitTelegramMessage(text: string, maxLen = 3500): string[] {
    const t = (text ?? '').trim();
    if (!t) return [''];

    if (t.length <= maxLen) return [t];

    // Очень простой безопасный сплит по пустым строкам (не "шаг 5", просто защита)
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

      // если один блок сам по себе огромный — режем грубо
      while (current.length > maxLen) {
        chunks.push(current.slice(0, maxLen));
        current = current.slice(maxLen);
      }
    }

    if (current) chunks.push(current);
    return chunks.filter((c) => c.trim().length > 0);
  }
}
