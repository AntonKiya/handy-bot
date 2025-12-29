import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class QwenClient {
  private readonly logger = new Logger(QwenClient.name);
  private readonly client: OpenAI | null;

  constructor() {
    const apiKey = process.env.QWEN_API_KEY;

    if (!apiKey) {
      this.logger.warn(
        'QWEN_API_KEY is not set. QwenClient will not be able to call Qwen.',
      );
      this.client = null;
      return;
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    });
  }

  /**
   * Низкоуровневый метод: даём текст — получаем текст.
   * Тут `prompt` превращаем в messages (system+user), чтобы было ближе к chat-модели.
   */
  async generateText(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('QwenClient is not initialized (no QWEN_API_KEY).');
    }

    try {
      const response = await this.client.chat.completions.create({
        model: 'qwen2.5-7b-instruct',
        stream: false,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict assistant that follows the output format exactly. Return only the final answer with no extra text.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const text = response.choices?.[0]?.message?.content ?? '';
      return text.toString().trim();
    } catch (e) {
      this.logger.error('Error while calling Qwen', e as any);
      throw e;
    }
  }
}
