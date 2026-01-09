import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  SummaryChannelAiService,
  SummaryInputMap,
} from './summary-channel-ai.service';

export interface ParsedChannelPost {
  id: number;
  text: string;
  date?: Date;
}

@Injectable()
export class SummaryChannelService {
  private readonly logger = new Logger(SummaryChannelService.name);

  constructor(
    private readonly summaryChannelAiService: SummaryChannelAiService,
  ) {}

  async fetchRecentTextPostsForChannel(
    channelNameWithAt: string,
  ): Promise<ParsedChannelPost[]> {
    const HOURS_WINDOW = 336;
    const cutoff = Date.now() - HOURS_WINDOW * 60 * 60 * 1000;

    const channelSlug = channelNameWithAt.replace(/^@/, '');
    let before: number | undefined;
    const result: ParsedChannelPost[] = [];

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
          result.push({ id, text, date });
        }
      });

      if (!idsOnPage.length) break;

      before = Math.min(...idsOnPage);

      if (oldestDateOnPage && oldestDateOnPage.getTime() < cutoff) {
        break;
      }
    }

    this.logger.debug(
      `Fetched ${result.length} text posts for channel ${channelSlug} (last ${HOURS_WINDOW}h)`,
    );

    return result;
  }

  /**
   * Хелпер для доменного уровня:
   * 1) Парсит посты за окно времени;
   * 2) Кормит их в LLM;
   * 3) Возвращает массив с id и summary.
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
}
