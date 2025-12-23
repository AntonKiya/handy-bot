import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { CommandRouter } from './routers/command.router';
import { MessageRouter } from './routers/message.router';
import { CallbackRouter } from './routers/callback.router';
import { MembershipRouter } from './routers/membership.router';
import { ReactionRouter } from './routers/reaction.router';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf<Context>;

  constructor(
    private readonly commandRouter: CommandRouter,
    private readonly messageRouter: MessageRouter,
    private readonly callbackRouter: CallbackRouter,
    private readonly membershipRouter: MembershipRouter,
    private readonly reactionRouter: ReactionRouter,
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
    this.bot.on('text', (ctx) => this.messageRouter.route(ctx));

    this.bot.on('message', (ctx) => this.messageRouter.route(ctx));

    // Централизованный обработчик callback_query (кнопки)
    this.bot.on('callback_query', (ctx) => this.callbackRouter.route(ctx));

    // Централизованный обработчик my_chat_member (добавление бота)
    this.bot.on('my_chat_member', (ctx) => this.membershipRouter.route(ctx));

    this.bot.on('message_reaction', (ctx) => this.reactionRouter.route(ctx));

    this.bot
      .launch({
        allowedUpdates: [
          'message',
          'callback_query',
          'my_chat_member',
          'message_reaction',
        ],
      })
      .then(() => this.logger.log('Telegram bot successfully launched'))
      .catch((err) => this.logger.error('Failed to launch bot', err));
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down Telegram bot (${signal})`);
    this.bot.stop(signal);
  }
}
