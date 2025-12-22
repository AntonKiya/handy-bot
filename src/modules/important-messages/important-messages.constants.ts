export const THRESHOLDS = {
  QUESTION: 4,
  LEAD: 6,
  NEGATIVE: 5,
  HYPE: 5,
} as const;

export const WEIGHTS = {
  QUESTION: {
    HAS_QUESTION_MARK: 2,
    BASE_WORDS: 2,
    CONTEXT_WORDS: 1,
    LONG_TEXT: 1,
  },
  LEAD: {
    BASE_WORDS: 4,
    CONTEXT_WORDS: 3,
    QUESTION_WITH_LEAD: 2,
  },
  NEGATIVE: {
    BASE_WORDS: 4,
    CONTEXT_WORDS: 2,
  },
  HYPE: {
    HIGH_REACTIONS: 3,
    HIGH_REPLIES: 3,
    VERY_HIGH_ENGAGEMENT: 5,
  },
} as const;

export const MIN_WORD_COUNT = 3; // минимум слов для обработки

export const CACHE_CONFIG = {
  CONTEXT_TTL_MS: 30 * 60 * 1000, // 30 минут
  MAX_CACHE_SIZE: 500,
  CLEANUP_INTERVAL_MS: 15 * 60 * 1000, // 15 минут - интервал очистки кеша
} as const;
