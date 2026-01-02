import { Markup } from 'telegraf';
import { SUMMARY_CHANNEL_CB } from '../summary-channel/summary-channel.callbacks';
// import { SUMMARY_COMMENTS_CB } from '../summary-comments/summary-comments.callbacks';
import { CHANNELS_CB } from '../user-channels/user-channels.callbacks';
import {
  CORE_CHANNEL_USERS_NAMESPACE,
  CoreChannelUsersAction,
} from '../core-channel-users/core-channel-users.callbacks';

export function buildMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Саммари каналов 📝🎯', SUMMARY_CHANNEL_CB.open)],
    // TODO: Summary comments temporary disabled
    // [
    //   Markup.button.callback(
    //     'Саммари комментариев 💬🎯',
    //     SUMMARY_COMMENTS_CB.addNew,
    //   ),
    // ],
    [Markup.button.callback('Мои каналы 📝👑', CHANNELS_CB.open)],
    [
      Markup.button.callback(
        'Ядро пользователей сообщества',
        `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.Open}`,
      ),
    ],
  ]);
}
