import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { MenuService } from '../../modules/core-modules/menu/menu.service';
import { UserService } from '../../modules/core-modules/user/user.service';

@Injectable()
export class CommandRouter {
  constructor(
    private readonly menuService: MenuService,
    private readonly userService: UserService,
  ) {}

  async route(ctx: Context) {
    const telegramUserId = ctx.from?.id;
    if (telegramUserId) {
      await this.userService.upsertTelegramUser(
        telegramUserId,
        ctx.from?.username ?? null,
      );
    }

    const messageText =
      ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const command = messageText.split(' ')[0];

    switch (command) {
      case '/start':
        return this.menuService.showMainMenuWithInstructions(ctx);
      case '/menu':
        return this.menuService.showMainMenu(ctx);
      default:
        return;
    }
  }
}
