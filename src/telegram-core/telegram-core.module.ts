import { Module } from '@nestjs/common';
import { TelegramCoreService } from './telegram-core.service';

@Module({
  providers: [TelegramCoreService],
  exports: [TelegramCoreService],
})
export class TelegramCoreModule {}
