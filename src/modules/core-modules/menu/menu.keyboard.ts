import { Markup } from 'telegraf';
import { SUMMARY_CHANNEL_CB } from '../../feature-modules/summary-channel/summary-channel.callbacks';
import { CHANNELS_CB } from '../user-channels/user-channels.callbacks';
import {
  CORE_CHANNEL_USERS_NAMESPACE,
  CoreChannelUsersAction,
} from '../../feature-modules/core-channel-users/core-channel-users.callbacks';

export function buildMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        'Саммари каналов 📝🎯',
        SUMMARY_CHANNEL_CB.openMenu,
      ),
    ],
    [Markup.button.callback('Мои каналы 📝👑', CHANNELS_CB.openMenu)],
    [
      Markup.button.callback(
        'Ядро пользователей сообщества',
        `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.OpenMenu}`,
      ),
    ],
  ]);
}
