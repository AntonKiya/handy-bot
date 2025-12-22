export interface CategorizationResult {
  categories: string[];
  scores: {
    question: number;
    lead: number;
    negative: number;
    hype: number;
  };
  signals?: {
    question: string[];
    lead: string[];
    negative: string[];
    hype: string[];
  };
}

export interface ScorerResult {
  score: number;
  signals: string[];
}

export type CategoryType = 'question' | 'lead' | 'negative';
export type DictionaryType = 'base' | 'context';
