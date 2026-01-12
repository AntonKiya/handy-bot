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
    const instructions = `
Ты — система суммаризации постов.

Задача:
Суммируй КАЖДЫЙ пост из списка ниже РОВНО ОДНИМ сухим информативным предложением, передавая только основную тему и суть.

Жёсткие правила содержания:
- Ничего не добавляй от себя: никаких фактов, которых нет в тексте.
- Никаких выводов, интерпретаций, советов, оценок или эмоций.
- Не используй вводных фраз типа «пост о», «автор пишет», «в тексте говорится», «сообщается».
- Не усиливай и не смягчай тон, не «подогревай».
- Стиль всегда нейтральный, сухой, информативный.
- Если есть сомнение между формулировками — выбирай более буквальную и нейтральную.

Правило языка:
- Для КАЖДОГО поста используй тот язык, который доминирует в тексте этого поста.
- Если язык конкретного поста определить невозможно (только ссылка/эмодзи/числа), используй язык большинства постов в списке.
- Если и это невозможно — используй русский язык.

Крайние случаи (обработка статуса):
- Если в посте нет осмысленного текста (только ссылка, эмодзи, медиа или слишком короткий фрагмент без смысла), установи status = "skipped", summary = "", и кратко укажи причину в reason.
- Если текст присутствует, но полностью повреждён или нечитабелен, установи status = "error", summary = "", и кратко укажи причину в reason.
- В остальных случаях используй status = "ok" и заполни summary.

Ограничение длины summary:
- Стремись к 12–25 словам (или до ~160 символов).
- Без лишних деталей и перечислений.
`.trim();

    const input = {
      posts: Object.entries(posts).map(([id, text]) => ({
        id: String(id),
        text: (text ?? '').replace(/\s+/g, ' ').trim(),
      })),
    };

    return `${instructions}\n\nВходные данные (JSON):\n${JSON.stringify(input)}`;
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
