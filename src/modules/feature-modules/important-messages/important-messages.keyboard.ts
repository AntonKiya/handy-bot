import { Markup } from 'telegraf';
import { IMPORTANT_MESSAGES_CB } from './important-messages.callbacks';

export function buildImportantMessagesNotificationKeyboard(
  messageLink: string,
  messageId: string,
) {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('Открыть', messageLink),
      Markup.button.callback(
        'Готово',
        IMPORTANT_MESSAGES_CB.doneAlert(messageId),
      ),
    ],
  ]);
}

export function buildImportantMessagesMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Мои каналы', IMPORTANT_MESSAGES_CB.listMenu)],
    [
      Markup.button.callback(
        'Добавить канал',
        IMPORTANT_MESSAGES_CB.addChannelMenu,
      ),
    ],
    [Markup.button.callback('⬅ Главное меню', IMPORTANT_MESSAGES_CB.backMenu)],
  ]);
}

/**
 * Экран "Мои каналы" внутри important-messages:
 * - если canAdd=false (лимит достигнут) — показываем только "Назад"
 * - если canAdd=true — показываем "Добавить канал" + "Назад"
 */
export function buildImportantMessagesChannelsKeyboard(canAdd: boolean) {
  const rows: any[] = [];

  if (canAdd) {
    rows.push([
      Markup.button.callback(
        'Добавить канал',
        IMPORTANT_MESSAGES_CB.addChannelMenu,
      ),
    ]);
  }

  // Назад → возвращаемся в меню important-messages
  rows.push([
    Markup.button.callback('⬅ Назад', IMPORTANT_MESSAGES_CB.openMenu),
  ]);

  return Markup.inlineKeyboard(rows);
}

export function buildImportantMessagesAddChannelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '⬅ Назад',
        IMPORTANT_MESSAGES_CB.cancelAddChannelMenu,
      ),
    ],
  ]);
}
