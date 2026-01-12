import { Injectable, Logger } from '@nestjs/common';
import { QwenClient } from '../../../ai/qwen.clinet';
import { OpenAI } from 'openai';
import ResponseFormatJSONSchema = OpenAI.ResponseFormatJSONSchema;

export type SummaryInputMap = Record<string, string>;
export type SummaryOutputMap = Record<string, string>;

export type AiSummaryItem = {
  id: string;
  status: 'ok' | 'skipped' | 'error';
  summary: string;
  reason?: string;
};

@Injectable()
export class SummaryChannelAiService {
  private readonly logger = new Logger(SummaryChannelAiService.name);

  private readonly MAX_RETRIES = 2;

  constructor(private readonly qwenClient: QwenClient) {}

  async summarizePosts(posts: SummaryInputMap): Promise<AiSummaryItem[]> {
    const ids = Object.keys(posts);
    if (!ids.length) return [];

    const prompt = this.buildPrompt(posts);

    const responseFormat: ResponseFormatJSONSchema = {
      type: 'json_schema',
      json_schema: {
        name: 'summary_posts_v1',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'status', 'summary'],
                properties: {
                  id: { type: 'string' },
                  status: {
                    type: 'string',
                    enum: ['ok', 'skipped', 'error'],
                  },
                  summary: { type: 'string' },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const raw = await this.qwenClient.generateText(prompt, responseFormat);

        this.logger.debug(
          `LLM raw response (attempt ${attempt}): ${String(raw).slice(0, 500)}`,
        );

        const items = this.parseResponse(raw);

        if (items !== null) {
          return items;
        }

        this.logger.warn(
          `LLM response parsing failed (attempt ${attempt}/${this.MAX_RETRIES}). Raw: ${String(raw).slice(0, 300)}`,
        );
      } catch (e: any) {
        lastError = e;
        this.logger.error(
          `LLM call failed (attempt ${attempt}/${this.MAX_RETRIES}): ${e.message}`,
        );
      }

      // Небольшая задержка перед retry
      if (attempt < this.MAX_RETRIES) {
        await this.sleep(500 * attempt);
      }
    }

    this.logger.error(
      `All ${this.MAX_RETRIES} LLM attempts failed for ${ids.length} posts`,
      lastError,
    );

    return [];
  }

  private parseResponse(raw: string): AiSummaryItem[] | null {
    // Проверяем, что raw — строка
    if (typeof raw !== 'string') {
      this.logger.warn(`LLM returned non-string: ${typeof raw}`);
      return null;
    }

    const trimmed = raw.trim();

    // Проверяем, что это похоже на JSON
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      this.logger.warn(
        `LLM response is not JSON-like: ${trimmed.slice(0, 100)}`,
      );
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      this.logger.warn(`JSON parse error: ${(e as Error).message}`);
      return null;
    }

    // Поддержка обоих ключей: items (правильный) и posts (fallback)
    const items = parsed?.items ?? parsed?.posts;

    if (!Array.isArray(items)) {
      this.logger.warn(`Parsed response has no items[] or posts[] array`);
      return null;
    }

    // Валидация каждого item
    const validated: AiSummaryItem[] = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const id = String(item.id ?? '').trim();
      if (!id) continue;

      const status = this.validateStatus(item.status);
      const summary = status === 'ok' ? String(item.summary ?? '').trim() : '';
      const reason = item.reason ? String(item.reason).trim() : undefined;

      validated.push({ id, status, summary, reason });
    }

    if (validated.length === 0 && items.length > 0) {
      this.logger.warn(`All ${items.length} items failed validation`);
      return null;
    }

    return validated;
  }

  private validateStatus(status: unknown): 'ok' | 'skipped' | 'error' {
    if (status === 'skipped') return 'skipped';
    if (status === 'error') return 'error';
    return 'ok';
  }

  private buildPrompt(posts: SummaryInputMap): string {
    const instructions = `
      Ты — система суммаризации постов.
      
      Задача:
      Для каждого поста верни краткое суммарное описание РОВНО В ОДНОМ предложении, передавая только основную тему и суть.
      
      Правила (строго):
      - Не добавляй ничего от себя.
      - Не делай выводов или интерпретаций.
      - Не используй оценок и эмоциональных формулировок.
      - Не используй вводные фразы вроде «пост о», «автор пишет», «в тексте говорится».
      - Не подогревай интерес, не усиливай и не смягчай тон.
      - Стиль: нейтральный, сухой, информативный.
      - Язык summary должен совпадать с языком исходного текста конкретного поста.
      - Суммируй каждый пост отдельно, в порядке появления.
      - id возвращай без изменений.
      
      Обработка ошибок (status):
      - ok: если текст поста присутствует и ты можешь сделать корректное одно-предложное summary.
      - skipped: если текст пустой/почти пустой/содержит только мусор (например, один символ), тогда summary = "" и reason коротко объясняет почему.
      - error: если текст есть, но по нему нельзя сделать корректное summary (например, полностью повреждённый/нечитабельный), тогда summary = "" и reason коротко объясняет почему.
      
      Важно:
      - Summary должно быть ровно одно предложение (одно законченное предложение).
      - Если status = ok, reason не заполняй.
      - Если status = skipped или error, заполни reason (коротко), а summary оставь пустым.
      
      КРИТИЧЕСКИ ВАЖНО:
      - Обрабатывай посты СТРОГО В ТОМ ЖЕ ПОРЯДКЕ, в каком они даны.
      - Каждый id в ответе ДОЛЖЕН ТОЧНО соответствовать id из входных данных.
      - НЕ путай содержимое разных постов между собой.
      
      ВЫХОДНОЙ ФОРМАТ:
      Верни ТОЛЬКО валидный JSON с единственным ключом "items" — массив объектов.
      НЕ используй ключ "posts". Используй ТОЛЬКО ключ "items".
      Пример:
      {"items":[{"id":"123","status":"ok","summary":"Текст саммари."}]}
`.trim();

    const input = {
      posts: Object.entries(posts).map(([id, text]) => ({
        id: String(id),
        text: (text ?? '').replace(/\s+/g, ' ').trim(),
      })),
    };

    return `${instructions}\n\nВходные данные (JSON):\n${JSON.stringify(input)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
