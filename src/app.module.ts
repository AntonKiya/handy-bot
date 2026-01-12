import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Joi from 'joi';
import * as path from 'path';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { StateModule } from './common/state/state.module';
import { SummaryChannelModule } from './modules/feature-modules/summary-channel/summary-channel.module';
import { MenuModule } from './modules/core-modules/menu/menu.module';
import { UserModule } from './modules/core-modules/user/user.module';
import { ChannelModule } from './modules/core-modules/channel/channel.module';
import { UserChannelsModule } from './modules/core-modules/user-channels/user-channels.module';
import { CoreChannelUsersModule } from './modules/feature-modules/core-channel-users/core-channel-users.module';
import { TelegramCoreModule } from './telegram-core/telegram-core.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: Joi.object({
        DATABASE_HOST: Joi.string().required(),
        DATABASE_PORT: Joi.string().required(),
        DATABASE_USERNAME: Joi.string().required(),
        DATABASE_PASSWORD: Joi.string().required(),
        DATABASE_NAME: Joi.string().required(),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT'),
        username: configService.get<string>('DATABASE_USERNAME'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
        autoLoadEntities: true,
        migrationsRun: true,
        migrations: [path.join(__dirname, 'migrations/**/*{.ts,.js}')],
        ssl:
          configService.get('NODE_ENV', 'production') === 'development'
            ? false
            : { rejectUnauthorized: false },
        extra: {
          max: 20,
          idleTimeoutMillis: 30000,
        },
      }),
    }),
    StateModule,
    TelegramCoreModule,
    TelegramBotModule,
    SummaryChannelModule,
    MenuModule,
    UserModule,
    ChannelModule,
    UserChannelsModule,
    CoreChannelUsersModule,
    HealthcheckModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
