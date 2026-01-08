import { Injectable } from '@nestjs/common';
import { WEIGHTS } from '../../important-messages.constants';
import { ScorerResult } from '../types';

@Injectable()
export class HypeScorer {
  /**
   * Расчет скора для категории "hype"
   *
   * Сигналы:
   * - реакций ≥ 5 → +3
   * - ответов ≥ 3 → +3
   * - реакций + ответов ≥ 10 → +5
   */
  calculateScore(reactionsCount: number, repliesCount: number): ScorerResult {
    let score = 0;
    const signals: string[] = [];

    // Высокое количество реакций
    if (reactionsCount >= 5) {
      score += WEIGHTS.HYPE.HIGH_REACTIONS;
      signals.push('high_reactions');
    }

    // Высокое количество ответов
    if (repliesCount >= 3) {
      score += WEIGHTS.HYPE.HIGH_REPLIES;
      signals.push('high_replies');
    }

    // Очень высокая вовлеченность (комбинация)
    if (reactionsCount + repliesCount >= 10) {
      score += WEIGHTS.HYPE.VERY_HIGH_ENGAGEMENT;
      signals.push('very_high_engagement');
    }

    return { score, signals };
  }
}
