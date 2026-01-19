import { Markup } from 'telegraf';
import { SUMMARY_CHANNEL_CB } from '../../feature-modules/summary-channel/summary-channel.callbacks';
import { IMPORTANT_MESSAGES_CB } from '../../feature-modules/important-messages/important-messages.callbacks';
import {
  CORE_CHANNEL_USERS_NAMESPACE,
  CoreChannelUsersAction,
} from '../../feature-modules/core-channel-users/core-channel-users.callbacks';

export function buildMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        'Саммари постов канала 📝🎯',
        SUMMARY_CHANNEL_CB.openMenu,
      ),
    ],
    [
      Markup.button.callback(
        'Важные сообщения 🌟💬',
        IMPORTANT_MESSAGES_CB.openMenu,
      ),
    ],
    [
      Markup.button.callback(
        'Ядро комментаторов 👥🏆',
        `${CORE_CHANNEL_USERS_NAMESPACE}:${CoreChannelUsersAction.OpenMenu}`,
      ),
    ],
  ]);
}
