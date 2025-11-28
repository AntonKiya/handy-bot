import { Injectable } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import * as path from 'path';

@Injectable()
export class MenuService {
  async showMainMenu(ctx: Context) {
    const caption = 'Главное меню';

    const imagePath = path.join(
      __dirname,
      '../../../assets/images/main-menu.png',
    );

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Саммари каналов 📝🎯', 'summary:channel:open')],
    ]);

    await ctx.replyWithPhoto(
      { source: imagePath },
      {
        caption,
        ...keyboard,
      },
    );
  }
}
