import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { CommandRouter } from './routers/command.router';
import { TextRouter } from './routers/text.router';
import { CallbackRouter } from './routers/callback.router';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf<Context>;

  constructor(
    private readonly commandRouter: CommandRouter,
    private readonly textRouter: TextRouter,
    private readonly callbackRouter: CallbackRouter,
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
    this.bot.on('text', (ctx) => this.textRouter.route(ctx));

    // Централизованный обработчик callback_query (кнопки)
    this.bot.on('callback_query', (ctx) => this.callbackRouter.route(ctx));

    this.bot.launch();
    this.logger.log('Telegram bot launched');
  }
}
