import { Injectable } from '@nestjs/common';
import { WEIGHTS } from '../../important-messages.constants';
import { ScorerResult } from '../types';
import { hasWordsFromDictionary } from '../text-normalizer.util';

@Injectable()
export class NegativeScorer {
  /**
   * Расчет скора для категории "negative"
   *
   * Сигналы:
   * - base негатив слова/фразы → +4
   * - context упоминания бренда/админа/@username → +2
   */
  calculateScore(
    normalizedText: string,
    baseWords: Set<string>,
    contextWords: Set<string>,
  ): ScorerResult {
    let score = 0;
    const signals: string[] = [];

    // Проверка base словаря (негативные слова)
    if (hasWordsFromDictionary(normalizedText, baseWords)) {
      score += WEIGHTS.NEGATIVE.BASE_WORDS;
      signals.push('has_base_negative_words');
    }

    // Проверка context словаря (упоминания бренда/@username)
    if (
      contextWords.size > 0 &&
      hasWordsFromDictionary(normalizedText, contextWords)
    ) {
      score += WEIGHTS.NEGATIVE.CONTEXT_WORDS;
      signals.push('mentions_brand_or_admin');
    }

    return { score, signals };
  }
}
