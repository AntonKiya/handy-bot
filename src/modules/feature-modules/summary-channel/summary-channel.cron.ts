import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SummaryChannelService } from './summary-channel.service';

@Injectable()
export class SummaryChannelCron {
  private readonly logger = new Logger(SummaryChannelCron.name);

  constructor(private readonly summaryChannelService: SummaryChannelService) {}

  /**
   * Плановая генерация саммари раз в день в фиксированное время.
   * Важно: cron — только триггер, бизнес-логика в сервисе.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3PM)
  async runDaily() {
    this.logger.log('Starting planned summary-channel run...');
    await this.summaryChannelService.runPlannedSummaries();
    this.logger.log('Planned summary-channel run finished.');
  }
}
