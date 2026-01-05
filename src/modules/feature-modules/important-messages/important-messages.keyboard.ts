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
    [
      Markup.button.callback(
        'Проверить подключение',
        IMPORTANT_MESSAGES_CB.verifyMenu,
      ),
    ],
    [Markup.button.callback('⬅ Главное меню', IMPORTANT_MESSAGES_CB.backMenu)],
  ]);
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
