import { Module } from '@nestjs/common';
import { GeminiClient } from './gemini.client';
import { QwenClient } from './qwen.clinet';

@Module({
  providers: [GeminiClient, QwenClient],
  exports: [GeminiClient, QwenClient],
})
export class AiModule {}
