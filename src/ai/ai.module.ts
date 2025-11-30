import { Module } from '@nestjs/common';
import { GeminiClient } from './gemini.client';

@Module({
  providers: [GeminiClient],
  exports: [GeminiClient],
})
export class AiModule {}
