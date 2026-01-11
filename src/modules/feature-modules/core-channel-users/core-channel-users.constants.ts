export const TOP_USERS_AMOUNT = 50;

// Telegram getMessages limit
export const DISCUSSION_BATCH_LIMIT = 100;

// Safety: чтобы не бесконечно листать группу, если окно слишком большое / что-то пошло не так
export const MAX_DISCUSSION_MESSAGES_SCAN = 50_000;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Legacy константы (остались от старого "sync в БД" подхода).
 * Сейчас в Core-community фиче больше не используются, но оставляем до коммита 9 (чистка).
 */
export const SYNC_WINDOW_DAYS = 90;
export const SYNC_COOLDOWN_DAYS = 1;

export const FRESH_POST_DAYS = 3;
export const MEDIUM_POST_DAYS = 10;

export const MEDIUM_RESYNC_INTERVAL_HOURS = 48;
export const MEDIUM_RESYNC_INTERVAL_MS =
  MEDIUM_RESYNC_INTERVAL_HOURS * 60 * 60 * 1000;
