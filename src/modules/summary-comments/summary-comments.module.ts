import { Module } from '@nestjs/common';
import { SummaryCommentsService } from './summary-comments.service';
import { SummaryCommentsFlow } from './summary-comments.flow';
import { StateModule } from '../../common/state/state.module';
import { TelegramCoreModule } from '../../telegram-core/telegram-core.module';
import { MenuModule } from '../menu/menu.module';

@Module({
  imports: [StateModule, TelegramCoreModule, MenuModule],
  providers: [SummaryCommentsService, SummaryCommentsFlow],
  exports: [SummaryCommentsFlow],
})
export class SummaryCommentsModule {}
