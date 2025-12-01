import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { StateModule } from './common/state/state.module';
import { SummaryChannelModule } from './modules/summary-channel/summary-channel.module';
import { MenuModule } from './modules/menu/menu.module';
import { TelegramCoreModule } from './telegram-core/telegram-core.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    StateModule,
    TelegramCoreModule,
    TelegramBotModule,
    SummaryChannelModule,
    MenuModule,
  ],
})
export class AppModule {}
