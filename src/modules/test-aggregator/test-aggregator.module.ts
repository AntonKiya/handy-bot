import { Module } from '@nestjs/common';
import { TestAggregatorService } from './test-aggregator.service';
import { BotListenerService } from './bot-listener.service';
import { CoreListenerService } from './core-listener.service';
import { TelegramCoreModule } from '../../telegram-core/telegram-core.module';
import { TelegramBotModule } from '../../telegram-bot/telegram-bot.module';

@Module({
  imports: [TelegramCoreModule, TelegramBotModule],
  providers: [TestAggregatorService, BotListenerService, CoreListenerService],
  exports: [TestAggregatorService],
})
export class TestAggregatorModule {}
