import { Markup } from 'telegraf';
import { SUMMARY_CHANNEL_CB } from '../summary-channel/summary-channel.callbacks';

export function buildMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Саммари каналов 📝🎯', SUMMARY_CHANNEL_CB.open)],
  ]);
}
