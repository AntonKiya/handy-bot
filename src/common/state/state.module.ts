import { Module } from '@nestjs/common';
import { UserStateService } from './user-state.service';

@Module({
  providers: [UserStateService],
  exports: [UserStateService],
})
export class StateModule {}
