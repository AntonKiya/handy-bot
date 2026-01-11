export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Как и в ТЗ: идём батчами по discussion group
export const DISCUSSION_BATCH_LIMIT = 100;

// Safety, чтобы не уйти в бесконечный скролл
export const MAX_DISCUSSION_MESSAGES_SCAN = 50_000;

// Сколько пользователей показываем в отчёте
export const TOP_USERS_AMOUNT = 10;
