import { Markup } from 'telegraf';
import { IMPORTANT_MESSAGES_CB } from './important-messages.callbacks';

export function buildImportantMessagesNotificationKeyboard(
  messageLink: string,
  messageId: string,
) {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('Открыть', messageLink),
      Markup.button.callback('Готово', IMPORTANT_MESSAGES_CB.doneAlert(messageId)),
    ],
  ]);
}
