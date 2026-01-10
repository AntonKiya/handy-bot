import { Module } from '@nestjs/common';
import { SummaryChannelService } from './summary-channel.service';
import { SummaryChannelFlow } from './summary-channel.flow';
import { StateModule } from '../../../common/state/state.module';
import { MenuModule } from '../../core-modules/menu/menu.module';
import { SummaryChannelAiService } from './summary-channel-ai.service';
import { AiModule } from '../../../ai/ai.module';
import { UserChannelsModule } from '../../core-modules/user-channels/user-channels.module';
import { ChannelModule } from '../../core-modules/channel/channel.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SummaryChannelResultEntity } from './summary-channel-result.entity';
import { SummaryChannelRunEntity } from './summary-channel-run.entity';
import { SummaryChannelCron } from './summary-channel.cron';
import { UserChannel } from '../../core-modules/user-channels/user-channel.entity';
import { Telegraf } from 'telegraf';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SummaryChannelResultEntity,
      SummaryChannelRunEntity,
      UserChannel,
    ]),
    StateModule,
    MenuModule,
    AiModule,
    UserChannelsModule,
    ChannelModule,
  ],
  providers: [
    {
      provide: 'TELEGRAF_BOT',
      useFactory: () => {
        return new Telegraf(process.env.BOT_TOKEN!);
      },
    },
    SummaryChannelService,
    SummaryChannelFlow,
    SummaryChannelAiService,
    SummaryChannelCron,
  ],
  exports: [SummaryChannelFlow],
})
export class SummaryChannelModule {}
