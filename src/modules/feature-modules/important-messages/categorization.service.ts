import { Injectable, Logger } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { QuestionScorer } from './utils/scorers/question.scorer';
import { LeadScorer } from './utils/scorers/lead.scorer';
import { NegativeScorer } from './utils/scorers/negative.scorer';
import { normalizeText, getWordCount } from './utils/text-normalizer.util';
import { CategorizationResult } from './utils/types';
import { THRESHOLDS, MIN_WORD_COUNT } from './important-messages.constants';

@Injectable()
export class CategorizationService {
  private readonly logger = new Logger(CategorizationService.name);

  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly questionScorer: QuestionScorer,
    private readonly leadScorer: LeadScorer,
    private readonly negativeScorer: NegativeScorer,
  ) {}

  /**
   * Категоризация сообщения
   * Возвращает список категорий, скоры и сигналы
   */
  async categorizeMessage(params: {
    text: string;
    channelId: string;
  }): Promise<CategorizationResult> {
    const { text, channelId } = params;

    // Проверка минимальной длины (< 3-5 слов → не обрабатываем)
    const wordCount = getWordCount(text);
    if (wordCount < MIN_WORD_COUNT) {
      this.logger.debug(
        `Message too short (${wordCount} words), skipping categorization`,
      );
      return {
        categories: [],
        scores: {
          question: 0,
          lead: 0,
          negative: 0,
        },
      };
    }

    // Нормализация текста
    const normalizedText = normalizeText(text);

    // Загрузка словарей
    const [
      baseQuestionWords,
      contextQuestionWords,
      baseLeadWords,
      contextLeadWords,
      baseNegativeWords,
      contextNegativeWords,
    ] = await Promise.all([
      this.dictionaryService.getBaseWords('question'),
      this.dictionaryService.getContextWords('question', channelId),
      this.dictionaryService.getBaseWords('lead'),
      this.dictionaryService.getContextWords('lead', channelId),
      this.dictionaryService.getBaseWords('negative'),
      this.dictionaryService.getContextWords('negative', channelId),
    ]);

    // Вызов scorers
    const questionResult = this.questionScorer.calculateScore(
      normalizedText,
      text,
      baseQuestionWords,
      contextQuestionWords,
    );

    const leadResult = this.leadScorer.calculateScore(
      normalizedText,
      text,
      baseLeadWords,
      contextLeadWords,
    );

    const negativeResult = this.negativeScorer.calculateScore(
      normalizedText,
      baseNegativeWords,
      contextNegativeWords,
    );

    // Применение порогов
    const categories: string[] = [];

    if (questionResult.score >= THRESHOLDS.QUESTION) {
      categories.push('question');
    }

    if (leadResult.score >= THRESHOLDS.LEAD) {
      categories.push('lead');
    }

    if (negativeResult.score >= THRESHOLDS.NEGATIVE) {
      categories.push('negative');
    }

    const result: CategorizationResult = {
      categories,
      scores: {
        question: questionResult.score,
        lead: leadResult.score,
        negative: negativeResult.score,
      },
      signals: {
        question: questionResult.signals,
        lead: leadResult.signals,
        negative: negativeResult.signals,
      },
    };

    this.logger.debug(
      `Categorization result: ${categories.join(', ') || 'none'} (scores: Q=${questionResult.score}, L=${leadResult.score}, N=${negativeResult.score})`,
    );

    return result;
  }
}
