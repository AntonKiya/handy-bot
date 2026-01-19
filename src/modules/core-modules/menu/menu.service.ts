import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { buildMainMenuKeyboard } from './menu.keyboard';

@Injectable()
export class MenuService {
  private readonly mainMenuText = 'Добро пожаловать! Здесь 3 функции:';
  private readonly mainMenuTextWithInstructions = `
    📝 Саммари каналов
    
    Раз в день бот присылает краткую сводку постов выбранных каналов (например, конкурентов).
    
    Как использовать: нажмите «Саммари каналов», отправьте @username канала — бот подтвердит и начнёт присылать ежедневные отчёты за 24 часа.
    
    ⭐️ Важные комментарии
    
    Помогает не пропускать вопросы, заявки, негатив и хайп в комментариях.
    
    Как использовать: нажмите «Важные сообщения» и добавьте бота админом в discussion group вашего канала. Он будет присылать алерты о:
    • Вопросах (цены, заказ)
    • Заявках (купить, написать)
    • Негативе (жалобы, мат)
    • Хайпе (много лайков)
    
    👥 Ядро сообщества
    
    Показывает топ-10 самых активных комментаторов канала.
    
    Как использовать: нажмите «Ядро сообщества», отправьте боту @channel-name — получите отчёт по активности.
`;

  async showMainMenuWithInstructions(ctx: Context) {
    const keyboard = buildMainMenuKeyboard();

    await ctx.reply(this.mainMenuTextWithInstructions, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  }

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
