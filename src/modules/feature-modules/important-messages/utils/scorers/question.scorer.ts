import { Injectable } from '@nestjs/common';
import { WEIGHTS } from '../../important-messages.constants';
import { ScorerResult } from '../types';
import { hasWordsFromDictionary } from '../text-normalizer.util';

@Injectable()
export class QuestionScorer {
  /**
   * Расчет скора для категории "question"
   *
   * Сигналы:
   * - ? знак в тексте → +2
   * - base question слова → +2
   * - context слова темы/продукта → +1
   * - длина > 30 символов → +1
   */
  calculateScore(
    normalizedText: string,
    originalText: string,
    baseWords: Set<string>,
    contextWords: Set<string>,
  ): ScorerResult {
    let score = 0;
    const signals: string[] = [];

    // Проверка на наличие вопросительного знака
    if (originalText.includes('?')) {
      score += WEIGHTS.QUESTION.HAS_QUESTION_MARK;
      signals.push('has_question_mark');
    }

    // Проверка base словаря
    if (hasWordsFromDictionary(normalizedText, baseWords)) {
      score += WEIGHTS.QUESTION.BASE_WORDS;
      signals.push('has_base_question_words');
    }

    // Проверка context словаря
    if (
      contextWords.size > 0 &&
      hasWordsFromDictionary(normalizedText, contextWords)
    ) {
      score += WEIGHTS.QUESTION.CONTEXT_WORDS;
      signals.push('has_context_words');
    }

    // Проверка длины текста
    if (originalText.length > 30) {
      score += WEIGHTS.QUESTION.LONG_TEXT;
      signals.push('long_text');
    }

    return { score, signals };
  }
}
