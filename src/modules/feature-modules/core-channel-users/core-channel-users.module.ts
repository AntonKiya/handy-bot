import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuModule } from '../../core-modules/menu/menu.module';
import { StateModule } from '../../../common/state/state.module';
import { TelegramCoreModule } from '../../../telegram-core/telegram-core.module';
import { CoreChannelUsersFlow } from './core-channel-users.flow';
import { CoreChannelUsersRunEntity } from './core-channel-users-run.entity';
import { CoreChannelUsersService } from './core-channel-users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoreChannelUsersRunEntity]),
    StateModule,
    MenuModule,
    TelegramCoreModule,
  ],
  providers: [CoreChannelUsersFlow, CoreChannelUsersService],
  exports: [CoreChannelUsersFlow],
})
export class CoreChannelUsersModule {}
