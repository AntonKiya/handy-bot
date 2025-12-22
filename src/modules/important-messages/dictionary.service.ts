import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DictionaryWord } from './dictionary-word.entity';
import { CategoryType } from './utils/types';
import { CACHE_CONFIG } from './important-messages.constants';

interface ContextCacheEntry {
  words: Set<string>;
  timestamp: Date;
}

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  // Кеш для base словарей (загружаются один раз)
  private baseWordsCache: Map<string, Set<string>> = new Map();

  // Кеш для context словарей (с TTL и LRU)
  private contextWordsCache: Map<string, ContextCacheEntry> = new Map();

  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(DictionaryWord)
    private readonly dictionaryRepository: Repository<DictionaryWord>,
  ) {
    // Запускаем периодическую очистку кеша
    this.startCacheCleanup();
  }

  /**
   * Получение base словаря для категории
   * Загружается один раз и кешируется навсегда
   */
  async getBaseWords(category: CategoryType): Promise<Set<string>> {
    const cacheKey = `${category}_base`;

    // Проверяем кеш
    if (this.baseWordsCache.has(cacheKey)) {
      return this.baseWordsCache.get(cacheKey)!;
    }

    // Загружаем из БД
    this.logger.debug(`Loading base dictionary for category: ${category}`);

    const dictionaries = await this.dictionaryRepository.find({
      where: {
        category,
        type: 'base',
        channel: null as any, // для base всегда null
      },
    });

    // Объединяем все слова из всех записей в один Set
    const wordsSet = new Set<string>();
    for (const dict of dictionaries) {
      if (Array.isArray(dict.words)) {
        dict.words.forEach((word) => wordsSet.add(word.toLowerCase().trim()));
      }
    }

    this.logger.debug(
      `Loaded ${wordsSet.size} base words for category: ${category}`,
    );

    // Сохраняем в кеш
    this.baseWordsCache.set(cacheKey, wordsSet);

    return wordsSet;
  }

  /**
   * Получение context словаря для канала и категории
   * Кешируется с TTL и LRU
   */
  async getContextWords(
    category: CategoryType,
    channelId: string,
  ): Promise<Set<string>> {
    const cacheKey = `${category}_${channelId}`;

    // Проверяем кеш с учетом TTL
    const cached = this.contextWordsCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp.getTime();
      if (age < CACHE_CONFIG.CONTEXT_TTL_MS) {
        return cached.words;
      } else {
        // Устаревшая запись, удаляем
        this.contextWordsCache.delete(cacheKey);
      }
    }

    // Загружаем из БД
    this.logger.debug(
      `Loading context dictionary for category: ${category}, channel: ${channelId}`,
    );

    const dictionaries = await this.dictionaryRepository.find({
      where: {
        category,
        type: 'context',
        channel: { id: channelId },
      },
      relations: ['channel'],
    });

    // Объединяем все слова
    const wordsSet = new Set<string>();
    for (const dict of dictionaries) {
      if (Array.isArray(dict.words)) {
        dict.words.forEach((word) => wordsSet.add(word.toLowerCase().trim()));
      }
    }

    this.logger.debug(
      `Loaded ${wordsSet.size} context words for category: ${category}, channel: ${channelId}`,
    );

    // Проверяем размер кеша, при превышении удаляем самую старую запись (LRU)
    if (this.contextWordsCache.size >= CACHE_CONFIG.MAX_CACHE_SIZE) {
      this.evictOldestEntry();
    }

    // Сохраняем в кеш
    this.contextWordsCache.set(cacheKey, {
      words: wordsSet,
      timestamp: new Date(),
    });

    return wordsSet;
  }

  /**
   * Удаление самой старой записи из context кеша (LRU)
   */
  private evictOldestEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.contextWordsCache.entries()) {
      if (entry.timestamp.getTime() < oldestTime) {
        oldestTime = entry.timestamp.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.contextWordsCache.delete(oldestKey);
      this.logger.debug(`Evicted oldest cache entry: ${oldestKey}`);
    }
  }

  /**
   * Периодическая очистка устаревших записей из кеша
   */
  private startCacheCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.clearExpiredCache();
    }, CACHE_CONFIG.CLEANUP_INTERVAL_MS);

    this.logger.debug(
      `Cache cleanup interval started: every ${CACHE_CONFIG.CLEANUP_INTERVAL_MS / 1000}s`,
    );
  }

  /**
   * Очистка устаревших записей из context кеша
   */
  private clearExpiredCache(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.contextWordsCache.entries()) {
      const age = now - entry.timestamp.getTime();
      if (age >= CACHE_CONFIG.CONTEXT_TTL_MS) {
        this.contextWordsCache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.logger.debug(`Cleared ${expiredCount} expired cache entries`);
    }
  }

  /**
   * Очистка при завершении работы приложения
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.logger.debug('Cache cleanup interval stopped');
    }
  }
}
