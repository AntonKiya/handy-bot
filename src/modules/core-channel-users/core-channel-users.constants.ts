export const SYNC_WINDOW_DAYS = 90;
export const SYNC_COOLDOWN_DAYS = 1;
export const TOP_USERS_AMOUNT = 10;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const FRESH_POST_DAYS = 3; // 0–3 дня - всегда ресинк
export const MEDIUM_POST_DAYS = 10; // 3–10 дней - периодический ресинк

export const MEDIUM_RESYNC_INTERVAL_HOURS = 48;
export const MEDIUM_RESYNC_INTERVAL_MS =
  MEDIUM_RESYNC_INTERVAL_HOURS * 60 * 60 * 1000;
