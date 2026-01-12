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

    const parsed = JSON.parse(raw);
    return parsed.items as AiSummaryItem[];
  }

  private buildPrompt(posts: SummaryInputMap): string {
    const instructions = `Ты — система суммаризации постов.
(правила — без изменений, как у тебя сейчас)
`.trim();

    const input = {
      posts: Object.entries(posts).map(([id, text]) => ({
        id,
        text: (text ?? '').replace(/\s+/g, ' ').trim(),
      })),
    };

    return `${instructions}\n\nВходные данные (JSON):\n${JSON.stringify(input)}`;
  }
}
