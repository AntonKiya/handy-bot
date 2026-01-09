import { Injectable, Logger } from '@nestjs/common';
import { QwenClient } from '../../../ai/qwen.clinet';

export type SummaryInputMap = Record<string, string>;
export type SummaryOutputMap = Record<string, string>;

@Injectable()
export class SummaryChannelAiService {
  private readonly logger = new Logger(SummaryChannelAiService.name);

  constructor(private readonly qwenClient: QwenClient) {}

  /**
   * Принимает объект вида { [id]: fullText }, возвращает { [id]: summaryText }.
   */
  async summarizePosts(posts: SummaryInputMap): Promise<SummaryOutputMap> {
    const ids = Object.keys(posts);

    if (!ids.length) {
      this.logger.debug('summarizePosts called with empty posts map');
      return {};
    }

    const prompt = this.buildPrompt(posts);
    this.logger.debug(
      `Sending ${ids.length} posts to Qwen for summarization...`,
    );

    const raw = await this.qwenClient.generateText(prompt);

    const parsed = this.parseResponse(raw, ids);
    this.logger.debug(
      `Got summaries for ${Object.keys(parsed).length} of ${ids.length} posts`,
    );

    return parsed;
  }

  /**
   * Собираем твой "жёсткий" промпт + список постов в формате:
   *
   *  <id>:<text>
   */
  private buildPrompt(posts: SummaryInputMap): string {
    const header = `
      Суммируй содержание каждого поста из списка ниже точно в одном предложении, передавая только основную тему и суть поста.
      
      Требования:
      Не добавляй ничего от себя.
      Не делай выводов или интерпретаций.
      Не используй оценок.
      Не используй вводных фраз вроде “пост о”, “автор пишет”, “в тексте говорится”.
      Не подогревай интерес, не усиливай и не смягчай тон.
      Сохраняй исходный стиль нейтральным, сухим и информативным.
      Суммируй каждый пост отдельно, в порядке появления.
      Идентификаторы постов должны быть возвращены без изменений.
      Язык суммированного результата не должен отличаться от языка в оригинальном тексте.
      
      Формат ответа (строго):
      <id1>:<одно предложение>@#&<id2>:<одно предложение>@#&<id3>:<одно предложение>@#&...
      
      Важно:
      Никаких переносов строк.
      Никаких пояснений.
      Никакого дополнительного текста до или после.
      Разделитель должен быть строго @#& без пробелов вокруг.
      В обобщении должно быть ровно одно предложение.
      
      Пример (для понимания):
      Оригинал:
      1: После «Аэрофлота» о возобновлении рейсов в Геленджик сообщила S7 Airlines. С 7 августа 2025 года — из Новосибирска, а с 8 августа — из Москвы. Закрытый с 2022 года аэропорт возобновил работу в июле
      Ответ:
      1:S7 Airlines анонсировала возобновление рейсов в Геленджик с августа 2025 года.@#&
      
      Посты:
    `.trim();

    const lines: string[] = [];

    for (const [id, text] of Object.entries(posts)) {
      const normalizedText = text.replace(/\s+/g, ' ').trim();
      lines.push(`${id}:${normalizedText}`);
    }

    return `${header}\n${lines.join('\n')}`;
  }

  /**
   * Разбираем строку вида:
   * "id1:summary1@#&id2:summary2@#&..."
   */
  private parseResponse(raw: string, expectedIds: string[]): SummaryOutputMap {
    const summaries: SummaryOutputMap = {};
    const expectedSet = new Set(expectedIds);

    if (!raw) {
      this.logger.warn('Empty response from model for summarizePosts');
      return summaries;
    }

    const parts = raw
      .split('@#&')
      .map((p) => p.trim())
      .filter(Boolean);

    for (const part of parts) {
      const colonIndex = part.indexOf(':');
      if (colonIndex === -1) {
        this.logger.warn(`Segment without colon in AI response: "${part}"`);
        continue;
      }

      const id = part.slice(0, colonIndex).trim();
      const summary = part.slice(colonIndex + 1).trim();

      if (!id || !summary) {
        this.logger.warn(`Empty id or summary in segment: "${part}"`);
        continue;
      }

      if (!expectedSet.has(id)) {
        this.logger.warn(`Unexpected id "${id}" in AI response`);
        continue;
      }

      summaries[id] = summary;
    }

    for (const id of expectedIds) {
      if (!summaries[id]) {
        this.logger.warn(`No summary produced for id=${id}`);
      }
    }

    return summaries;
  }
}
