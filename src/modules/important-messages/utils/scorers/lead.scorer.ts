import { Injectable } from '@nestjs/common';
import { WEIGHTS } from '../../important-messages.constants';
import { ScorerResult } from '../types';
import { hasWordsFromDictionary } from '../text-normalizer.util';

@Injectable()
export class LeadScorer {
  /**
   * Расчет скора для категории "lead"
   *
   * Сигналы:
   * - base лид/деньги слова+фразы → +4
   * - context продуктовые лид слова/фразы → +3
   * - ? + наличие base лид-сигнала → +2
   */
  calculateScore(
    normalizedText: string,
    originalText: string,
    baseWords: Set<string>,
    contextWords: Set<string>,
  ): ScorerResult {
    let score = 0;
    const signals: string[] = [];

    // Проверка base словаря (деньги/лид-фразы)
    const hasBaseLead = hasWordsFromDictionary(normalizedText, baseWords);
    if (hasBaseLead) {
      score += WEIGHTS.LEAD.BASE_WORDS;
      signals.push('has_base_lead_words');
    }

    // Проверка context словаря (продуктовые лид-слова)
    if (
      contextWords.size > 0 &&
      hasWordsFromDictionary(normalizedText, contextWords)
    ) {
      score += WEIGHTS.LEAD.CONTEXT_WORDS;
      signals.push('has_context_lead_words');
    }

    // Бонус если есть вопросительный знак + base лид-сигнал
    if (originalText.includes('?') && hasBaseLead) {
      score += WEIGHTS.LEAD.QUESTION_WITH_LEAD;
      signals.push('question_with_lead_signal');
    }

    return { score, signals };
  }
}
