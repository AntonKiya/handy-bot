import { Module } from '@nestjs/common';
import { SummaryChannelService } from './summary-channel.service';
import { SummaryChannelFlow } from './summary-channel.flow';
import { StateModule } from '../../common/state/state.module';

@Module({
  imports: [StateModule],
  providers: [SummaryChannelService, SummaryChannelFlow],
  exports: [SummaryChannelFlow],
})
export class SummaryChannelModule {}
