import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { CommandRouter } from './routers/command.router';
import { MessageRouter } from './routers/message.router';
import { CallbackRouter } from './routers/callback.router';
import { ReactionRouter } from './routers/reaction.router';
import { MenuModule } from '../modules/core-modules/menu/menu.module';
import { SummaryChannelModule } from '../modules/feature-modules/summary-channel/summary-channel.module';
import { StateModule } from '../common/state/state.module';
import { UserChannelsModule } from '../modules/core-modules/user-channels/user-channels.module';
import { CoreChannelUsersModule } from '../modules/feature-modules/core-channel-users/core-channel-users.module';
import { ImportantMessagesModule } from '../modules/feature-modules/important-messages/important-messages.module';
import { UserModule } from '../modules/core-modules/user/user.module';

@Module({
  imports: [
    MenuModule,
    UserModule,
    StateModule,
    SummaryChannelModule,
    UserChannelsModule,
    CoreChannelUsersModule,
    ImportantMessagesModule,
  ],
  providers: [
    TelegramBotService,
    CommandRouter,
    MessageRouter,
    CallbackRouter,
    ReactionRouter,
  ],
})
export class TelegramBotModule {}
