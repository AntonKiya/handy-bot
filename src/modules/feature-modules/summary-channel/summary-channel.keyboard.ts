import { Markup } from 'telegraf';
import { SUMMARY_CHANNEL_CB } from './summary-channel.callbacks';

export function buildSummaryChannelMenuKeyboard(canDetach: boolean) {
  const rows: any[] = [
    [Markup.button.callback('Мои каналы', SUMMARY_CHANNEL_CB.listMenu)],
    [
      Markup.button.callback(
        'Добавить канал',
        SUMMARY_CHANNEL_CB.addChannelMenu,
      ),
    ],
  ];

  if (canDetach) {
    rows.push([
      Markup.button.callback(
        'Отвязать канал',
        SUMMARY_CHANNEL_CB.detachChannelMenu,
      ),
    ]);
  }

  rows.push([
    Markup.button.callback('⬅ Главное меню', SUMMARY_CHANNEL_CB.backMenu),
  ]);

  return Markup.inlineKeyboard(rows);
}

/**
 * Экран "Мои каналы" внутри summary-channel:
 * - если canAdd=false (лимит достигнут) — показываем только "Назад"
 * - если canAdd=true — показываем "Добавить канал" + "Назад"
 */
export function buildSummaryChannelChannelsKeyboard(canAdd: boolean) {
  const rows: any[] = [];

  if (canAdd) {
    rows.push([
      Markup.button.callback(
        'Добавить канал',
        SUMMARY_CHANNEL_CB.addChannelMenu,
      ),
    ]);
  }

  // Назад → возвращаемся в меню summary-channel
  rows.push([Markup.button.callback('⬅ Назад', SUMMARY_CHANNEL_CB.openMenu)]);

  return Markup.inlineKeyboard(rows);
}

export function buildSummaryChannelAddChannelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅ Назад', SUMMARY_CHANNEL_CB.cancelAddMenu)],
  ]);
}

export function buildSummaryChannelDetachChannelsKeyboard(channels: string[]) {
  const rows: any[] = [];

  for (const ch of channels) {
    const normalized = normalizeChannelUsername(ch);
    const withoutAt = normalized.replace(/^@/, '');
    rows.push([
      Markup.button.callback(normalized, SUMMARY_CHANNEL_CB.detachChannel(withoutAt)),
    ]);
  }

  rows.push([Markup.button.callback('⬅ Назад', SUMMARY_CHANNEL_CB.openMenu)]);

  return Markup.inlineKeyboard(rows);
}

function normalizeChannelUsername(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return raw;
  return raw.startsWith('@') ? raw : `@${raw}`;
}
