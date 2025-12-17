import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CoreListenerService } from './core-listener.service';

@Injectable()
export class TestAggregatorService implements OnModuleInit {
  private readonly logger = new Logger(TestAggregatorService.name);

  constructor(private readonly coreListener: CoreListenerService) {}

  async onModuleInit() {
    this.logger.log('🚀 Test Aggregator Module initializing...');

    // BotListenerService инициализируется автоматически через OnModuleInit
    // Инициализация Core API listener
    await this.coreListener.init();

    this.logger.log('✅ Test Aggregator Module initialized successfully');
  }
}
