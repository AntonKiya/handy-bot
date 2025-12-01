import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { CommandRouter } from './routers/command.router';
import { TextRouter } from './routers/text.router';
import { CallbackRouter } from './routers/callback.router';
import { MenuModule } from '../modules/menu/menu.module';
import { SummaryChannelModule } from '../modules/summary-channel/summary-channel.module';
import { SummaryCommentsModule } from '../modules/summary-comments/summary-comments.module';
import { StateModule } from '../common/state/state.module';

@Module({
  imports: [
    MenuModule,
    StateModule,
    SummaryChannelModule,
    SummaryCommentsModule,
  ],
  providers: [TelegramBotService, CommandRouter, TextRouter, CallbackRouter],
})
export class TelegramBotModule {}
