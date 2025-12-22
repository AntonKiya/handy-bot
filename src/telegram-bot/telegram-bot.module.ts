import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { CommandRouter } from './routers/command.router';
import { MessageRouter } from './routers/message.router';
import { CallbackRouter } from './routers/callback.router';
import { MenuModule } from '../modules/menu/menu.module';
import { SummaryChannelModule } from '../modules/summary-channel/summary-channel.module';
import { SummaryCommentsModule } from '../modules/summary-comments/summary-comments.module';
import { StateModule } from '../common/state/state.module';
import { MembershipRouter } from './routers/membership.router';
import { UserChannelsModule } from '../modules/user-channels/user-channels.module';
import { CoreChannelUsersModule } from '../modules/core-channel-users/core-channel-users.module';
import { ImportantMessagesModule } from '../modules/important-messages/important-messages.module';

@Module({
  imports: [
    MenuModule,
    StateModule,
    SummaryChannelModule,
    SummaryCommentsModule,
    UserChannelsModule,
    CoreChannelUsersModule,
    ImportantMessagesModule,
  ],
  providers: [
    TelegramBotService,
    CommandRouter,
    MessageRouter,
    CallbackRouter,
    MembershipRouter,
  ],
})
export class TelegramBotModule {}
