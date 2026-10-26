export type YearRelation = "same" | "earlier" | "later";

export type GuessHints = {
  year: {
    value: number;
    relation: YearRelation;
    decadeMatch: boolean;
    within5: boolean;
  };
  director?: string;
  cast: string[];
  genres: string[];
  language?: string;
};

export type RevealedAnswer = {
  title: string;
  year: number;
  director?: string;
  cast?: string[];
  genres?: string[];
  language?: string;
  runtime?: number;
};

export type Clue = { n: number; total: number; label: string; text: string };

export type SearchSuggestion = {
  title: string;
  year: number;
  label: string;
  originalTitle?: string;
  director?: string;
  language?: string;
};

export type AttributeKind = "director" | "actor" | "year" | "genre" | "language";

export type AttributeSuggestion = {
  kind: AttributeKind;
  value: string;
  label: string;
};

export type AttributeCheckResult = {
  kind: AttributeKind;
  value: string;
  matched: boolean;
  message: string;
  hintsPatch: {
    director?: string;
    actor?: string;
    genre?: string;
    language?: string;
    year?: {
      value: number;
      relation: YearRelation;
      decadeMatch: boolean;
      within5: boolean;
    };
  };
};

export type CatalogMovie = {
  id: string;
  title: string;
  normalized_title: string;
  aliases: string[];
  year: number;
  genres: string[];
  plot: string;
  embedding: number[];
  is_active: boolean;
};

export type DailyPuzzleInfo = {
  date: string;
  status: "active";
  maxGuesses?: number | null;
};

export type GuessEvaluationResult =
  | {
      recognized: false;
      message: string;
    }
  | {
      recognized: true;
      isCorrect: boolean;
      similarity: number;
      similarityLabel: string;
      matchedTitle: string;
      hints: GuessHints;
      revealedAnswer?: RevealedAnswer;
    };

export class CatalogUnavailableError extends Error {
  constructor(message = "Movie catalog is currently unavailable or empty.") {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}
