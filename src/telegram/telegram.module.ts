import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { CommandRouter } from './routers/command.router';
import { TextRouter } from './routers/text.router';
import { CallbackRouter } from './routers/callback.router';
import { MenuModule } from '../modules/menu/menu.module';
import { SummaryChannelModule } from '../modules/summary-channel/summary-channel.module';
import { StateModule } from '../common/state/state.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [MenuModule, SummaryChannelModule, StateModule],
  providers: [
    TelegramBotService,
    CommandRouter,
    TextRouter,
    CallbackRouter,
    AiModule,
  ],
})
export class TelegramModule {}
