import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly client: GoogleGenAI | null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is not set. GeminiClient will not be able to call Gemini.',
      );
      this.client = null;
      return;
    }

    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Низкоуровневый метод: даём текст — получаем текст.
   */
  async generateText(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('GeminiClient is not initialized (no GEMINI_API_KEY).');
    }

    try {
      const response: any = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const text =
        response.text ??
        response.response?.text?.() ??
        (typeof response.response?.text === 'function'
          ? response.response.text()
          : '');

      return (text ?? '').toString().trim();
    } catch (e) {
      this.logger.error('Error while calling Gemini', e as any);
      throw e;
    }
  }
}
