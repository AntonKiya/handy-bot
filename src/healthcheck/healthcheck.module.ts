import { Module } from '@nestjs/common';
import { HealthcheckController } from './healthcheck.controller';

@Module({
  imports: [],
  controllers: [HealthcheckController],
})
export class HealthcheckModule {}
