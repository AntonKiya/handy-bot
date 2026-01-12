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

  constructor(private readonly qwenClient: QwenClient) {}

  async summarizePosts(posts: SummaryInputMap): Promise<AiSummaryItem[]> {
    const ids = Object.keys(posts);
    if (!ids.length) return [];

    const prompt = this.buildPrompt(posts);

    const responseFormat: ResponseFormatJSONSchema = {
      type: 'json_schema',
      json_schema: {
        name: 'summary_posts_v1',
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

    const raw = await this.qwenClient.generateText(prompt, responseFormat);

    console.log('raw', raw);

    const parsed = JSON.parse(raw);

    const items = parsed?.posts ?? parsed?.items;

    if (!Array.isArray(items)) {
      this.logger.warn(
        `LLM response has no items[] array. Raw: ${String(raw).slice(0, 500)}`,
      );
      return [];
    }

    return items as AiSummaryItem[];
  }

  private buildPrompt(posts: SummaryInputMap): string {
    // We rely on response_format (JSON Schema) for output structure.
    // Prompt focuses only on task + quality constraints + how to fill status/reason.

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
      `.trim();

    // Provide inputs as structured JSON to reduce ambiguity.
    const input = {
      posts: Object.entries(posts).map(([id, text]) => ({
        id: String(id),
        text: (text ?? '').replace(/\s+/g, ' ').trim(),
      })),
    };

    return `${instructions}\n\nВходные данные (JSON):\n${JSON.stringify(input)}`;
  }
}
