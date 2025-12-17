import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { CommandRouter } from './routers/command.router';
import { TextRouter } from './routers/text.router';
import { CallbackRouter } from './routers/callback.router';
import { MembershipRouter } from './routers/membership.router';
import { StateModule } from '../common/state/state.module';
import { MenuModule } from '../modules/menu/menu.module';
import { SummaryChannelModule } from '../modules/summary-channel/summary-channel.module';
import { SummaryCommentsModule } from '../modules/summary-comments/summary-comments.module';
import { UserChannelsModule } from '../modules/user-channels/user-channels.module';
import { CoreChannelUsersModule } from '../modules/core-channel-users/core-channel-users.module';

@Module({
  imports: [
    MenuModule,
    StateModule,
    SummaryChannelModule,
    SummaryCommentsModule,
    UserChannelsModule,
    CoreChannelUsersModule,
  ],
  providers: [
    TelegramBotService,
    CommandRouter,
    TextRouter,
    CallbackRouter,
    MembershipRouter,
  ],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
