import { Markup } from 'telegraf';
import { IMPORTANT_MESSAGES_CB } from './important-messages.callbacks';

type ChannelButtonInfo = {
  telegramChatId: string;
  username: string | null;
};

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

export function buildImportantMessagesMenuKeyboard(canDetach: boolean) {
  const rows: any[] = [
    [Markup.button.callback('Мои каналы', IMPORTANT_MESSAGES_CB.listMenu)],
    [
      Markup.button.callback(
        'Добавить канал',
        IMPORTANT_MESSAGES_CB.addChannelMenu,
      ),
    ],
  ];

  if (canDetach) {
    rows.push([
      Markup.button.callback(
        'Отвязать канал',
        IMPORTANT_MESSAGES_CB.detachChannelMenu,
      ),
    ]);
  }

  rows.push([
    Markup.button.callback('⬅ Главное меню', IMPORTANT_MESSAGES_CB.backMenu),
  ]);

  return Markup.inlineKeyboard(rows);
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

export function buildImportantMessagesDetachChannelsKeyboard(
  channels: ChannelButtonInfo[],
) {
  const rows: any[] = [];

  for (const ch of channels) {
    const title = ch.username ? `@${ch.username}` : `ID: ${ch.telegramChatId}`;
    rows.push([
      Markup.button.callback(
        title,
        IMPORTANT_MESSAGES_CB.detachChannel(ch.telegramChatId),
      ),
    ]);
  }

  rows.push([
    Markup.button.callback('⬅ Назад', IMPORTANT_MESSAGES_CB.openMenu),
  ]);

  return Markup.inlineKeyboard(rows);
}
