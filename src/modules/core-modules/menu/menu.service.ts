import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { buildMainMenuKeyboard } from './menu.keyboard';

@Injectable()
export class MenuService {
  private readonly mainMenuText = 'Добро пожаловать! Здесь 3 функции:';

  async showMainMenu(ctx: Context) {
    const keyboard = buildMainMenuKeyboard();

    await ctx.reply(this.mainMenuText, {
      ...keyboard,
    });
  }

  async redrawMainMenu(ctx: Context) {
    const keyboard = buildMainMenuKeyboard();

    await ctx.editMessageText(this.mainMenuText, {
      ...keyboard,
    });
  }
}
