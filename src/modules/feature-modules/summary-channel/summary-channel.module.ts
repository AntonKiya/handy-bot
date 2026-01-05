import { Module } from '@nestjs/common';
import { SummaryChannelService } from './summary-channel.service';
import { SummaryChannelFlow } from './summary-channel.flow';
import { StateModule } from '../../../common/state/state.module';
import { MenuModule } from '../../core-modules/menu/menu.module';
import { SummaryChannelAiService } from './summary-channel-ai.service';
import { AiModule } from '../../../ai/ai.module';

@Module({
  imports: [StateModule, MenuModule, AiModule],
  providers: [
    SummaryChannelService,
    SummaryChannelFlow,
    SummaryChannelAiService,
  ],
  exports: [SummaryChannelFlow],
})
export class SummaryChannelModule {}
