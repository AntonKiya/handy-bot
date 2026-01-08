import { Module } from '@nestjs/common';
import { TelegramAccessVerifierService } from './telegram-access-verifier.service';

@Module({
  providers: [TelegramAccessVerifierService],
  exports: [TelegramAccessVerifierService],
})
export class TelegramAccessModule {}
