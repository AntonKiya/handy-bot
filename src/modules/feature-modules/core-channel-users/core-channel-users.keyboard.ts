import { Markup } from 'telegraf';
import {
  CORE_CHANNEL_USERS_CB,
  CoreChannelUsersPeriod,
} from './core-channel-users.callbacks';

const PERIODS: Array<{ label: string; value: CoreChannelUsersPeriod }> = [
  { label: '14 дней', value: '14d' },
  { label: '90 дней', value: '90d' },
];

/**
 * Экран выбора периода:
 * - фиксированные периоды
 * - только "Главное меню" (т.к. "Назад" вёл бы туда же)
 */
export function buildCoreUsersPeriodKeyboard() {
  const rows: any[] = [];

  for (const p of PERIODS) {
    rows.push([
      Markup.button.callback(
        p.label,
        CORE_CHANNEL_USERS_CB.selectPeriod(p.value),
      ),
    ]);
  }

  rows.push([
    Markup.button.callback('⬅ Главное меню', CORE_CHANNEL_USERS_CB.mainMenu),
  ]);

  return Markup.inlineKeyboard(rows);
}

/**
 * Экран инструкции после выбора периода:
 * - только "Назад" (возврат к выбору периода)
 */
export function buildCoreUsersInputKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅ Назад', CORE_CHANNEL_USERS_CB.openMenu)],
  ]);
}

export function getCoreUsersPeriodLabel(
  period: CoreChannelUsersPeriod,
): string {
  return PERIODS.find((p) => p.value === period)?.label ?? period;
}
