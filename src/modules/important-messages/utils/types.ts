export interface CategorizationResult {
  categories: string[]; // 'question' | 'lead' | 'negative' (БЕЗ hype!)
  scores: {
    question: number;
    lead: number;
    negative: number;
  };
  signals?: {
    question: string[];
    lead: string[];
    negative: string[];
  };
}

export interface ScorerResult {
  score: number;
  signals: string[];
}

export type CategoryType = 'question' | 'lead' | 'negative';
export type DictionaryType = 'base' | 'context';
