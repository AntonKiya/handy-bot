/**
 * Нормализация текста для анализа
 * - Приводит к lowercase
 * - Удаляет знаки препинания
 * - Удаляет лишние пробелы
 * - Базовая очистка
 */
export function normalizeText(text: string): string {
  if (!text) {
    return '';
  }

  return text
    .toLowerCase()
    .replace(/[.,!?;:()"'«»—–\-]/g, ' ') // удаляем знаки препинания, заменяя на пробел
    .trim()
    .replace(/\s+/g, ' '); // заменяем множественные пробелы на один
}

/**
 * Подсчет количества слов в тексте
 */
export function getWordCount(text: string): number {
  if (!text || !text.trim()) {
    return 0;
  }

  return text.trim().split(/\s+/).length;
}

/**
 * Проверка наличия слов/фраз из словаря в тексте
 *
 * ОПТИМИЗАЦИЯ: Разбиваем текст пользователя на слова и проверяем каждое через Set.has()
 * Сложность: O(n) где n - количество слов в тексте пользователя
 * (вместо O(m) где m - размер словаря, который обычно намного больше)
 */
export function hasWordsFromDictionary(
  normalizedText: string,
  dictionary: Set<string>,
): boolean {
  if (!normalizedText || dictionary.size === 0) {
    return false;
  }

  // 1. Разбиваем текст на слова
  const userWords = normalizedText.split(/\s+/);

  // 2. Проверяем каждое слово через Set.has() - O(1) операция
  for (const word of userWords) {
    if (dictionary.has(word)) {
      return true;
    }
  }

  // 3. Отдельная проверка для фраз (которые содержат пробелы)
  // Собираем только фразы из словаря
  const phrases: string[] = [];
  for (const item of dictionary) {
    if (item.includes(' ')) {
      phrases.push(item);
    }
  }
  // Проверяем наличие фраз в тексте
  for (const phrase of phrases) {
    if (normalizedText.includes(phrase)) {
      return true;
    }
  }

  return false;
}
