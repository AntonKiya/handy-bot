import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { CommandRouter } from './routers/command.router';
import { TextRouter } from './routers/text.router';
import { CallbackRouter } from './routers/callback.router';
import { MembershipRouter } from './routers/membership.router';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf<Context>;

  private externalGroupMessageHandler: ((ctx: Context) => void) | null = null;
  private externalChannelPostHandler: ((ctx: Context) => void) | null = null;

  constructor(
    private readonly commandRouter: CommandRouter,
    private readonly textRouter: TextRouter,
    private readonly callbackRouter: CallbackRouter,
    private readonly membershipRouter: MembershipRouter,
  ) {}

  async onModuleInit() {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      this.logger.error('BOT_TOKEN is not set');
      throw new Error('BOT_TOKEN is required');
    }

    this.bot = new Telegraf<Context>(token);

    // Команды в нативном Menu
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Запустить бота' },
    ]);

    await this.bot.telegram.setChatMenuButton({
      menuButton: { type: 'commands' },
    });

    // Поддерживаемые команды
    this.bot.command('start', (ctx) => this.commandRouter.route(ctx));

    // Централизованный текстовый обработчик
    this.bot.on('text', (ctx) => {
      this.textRouter.route(ctx);

      // ДОБАВЛЕНО: вызываем внешний обработчик для групповых сообщений
      if (this.externalGroupMessageHandler) {
        this.externalGroupMessageHandler(ctx);
      }
    });

    // Централизованный обработчик callback_query (кнопки)
    this.bot.on('callback_query', (ctx) => this.callbackRouter.route(ctx));

    // Централизованный обработчик my_chat_member (добавление бота)
    this.bot.on('my_chat_member', (ctx) => this.membershipRouter.route(ctx));

    // ДОБАВЛЕНО: обработчик постов в каналах
    this.bot.on('channel_post', (ctx) => {
      if (this.externalChannelPostHandler) {
        this.externalChannelPostHandler(ctx);
      }
    });

    // ДОБАВЛЕНО: обработчик редактирования постов в каналах (опционально)
    this.bot.on('edited_channel_post', (ctx) => {
      if (this.externalChannelPostHandler) {
        this.externalChannelPostHandler(ctx);
      }
    });

    this.bot
      .launch()
      .then(() => this.logger.log('Telegram bot successfully launched'))
      .catch((err) => this.logger.error('Failed to launch bot', err));
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down Telegram bot (${signal})`);
    this.bot.stop(signal);
  }

  /**
   * ДОБАВЛЕНО: Регистрация внешнего обработчика для групповых сообщений
   */
  registerGroupMessageHandler(handler: (ctx: Context) => void) {
    this.externalGroupMessageHandler = handler;
    this.logger.log('External group message handler registered');
  }

  /**
   * ДОБАВЛЕНО: Регистрация внешнего обработчика для постов каналов
   */
  registerChannelPostHandler(handler: (ctx: Context) => void) {
    this.externalChannelPostHandler = handler;
    this.logger.log('External channel post handler registered');
  }
}
