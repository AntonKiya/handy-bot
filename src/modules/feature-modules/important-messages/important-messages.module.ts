import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportantMessage } from './important-message.entity';
import { DictionaryWord } from './dictionary-word.entity';
import { Channel } from '../../core-modules/channel/channel.entity';
import { DictionaryService } from './dictionary.service';
import { CategorizationService } from './categorization.service';
import { ImportantMessagesService } from './important-messages.service';
import { ImportantMessagesFlow } from './important-messages.flow';
import { QuestionScorer } from './utils/scorers/question.scorer';
import { LeadScorer } from './utils/scorers/lead.scorer';
import { NegativeScorer } from './utils/scorers/negative.scorer';
import { HypeScorer } from './utils/scorers/hype.scorer';
import { UserChannelsModule } from '../../core-modules/user-channels/user-channels.module';
import { ChannelModule } from '../../core-modules/channel/channel.module';
import { MenuModule } from '../../core-modules/menu/menu.module';
import { StateModule } from '../../../common/state/state.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportantMessage, DictionaryWord, Channel]),
    UserChannelsModule,
    ChannelModule,
    StateModule,
    MenuModule,
  ],
  providers: [
    // Services
    DictionaryService,
    CategorizationService,
    ImportantMessagesService,

    // Flow
    ImportantMessagesFlow,

    // Scorers
    QuestionScorer,
    LeadScorer,
    NegativeScorer,
    HypeScorer,
  ],
  exports: [ImportantMessagesService, ImportantMessagesFlow],
})
export class ImportantMessagesModule {}
