import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { MenuService } from '../../modules/menu/menu.service';

@Injectable()
export class CommandRouter {
  constructor(private readonly menuService: MenuService) {}

  async route(ctx: Context) {
    const messageText =
      ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const command = messageText.split(' ')[0];

    switch (command) {
      case '/start':
        return this.menuService.showMainMenu(ctx);
      default:
        return;
    }
  }
}
