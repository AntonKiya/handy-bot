import { Markup } from 'telegraf';
import { SUMMARY_CHANNEL_CB } from './summary-channel.callbacks';

export function buildSummaryChannelMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Мои каналы', SUMMARY_CHANNEL_CB.list)],
    [Markup.button.callback('Добавить канал', SUMMARY_CHANNEL_CB.add)],
    [Markup.button.callback('⬅ Главное меню', SUMMARY_CHANNEL_CB.back)],
  ]);
}
