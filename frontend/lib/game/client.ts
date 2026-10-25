import { apiFetch } from "@/lib/api/client";
import { searchLocalCatalog } from "./local-search";

export type DailyGame = {
  date: string;
  status: "active";
  maxGuesses?: number | null;
};

/** Facts the guessed film SHARES with today's film, plus the release-year direction. */
export type GuessHints = {
  year: {
    value: number;
    /** Where today's film sits relative to the guess: "later" = released after the guess. */
    relation: "same" | "earlier" | "later";
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

export type Clue = {
  n: number;
  total: number;
  label: string;
  text: string;
};

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
      relation: "same" | "earlier" | "later";
      decadeMatch: boolean;
      within5: boolean;
    };
  };
};

export type SearchCatalogResponse = {
  results: SearchSuggestion[];
  attributes: AttributeSuggestion[];
};

export type GuessEvaluationResponse =
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
      hints?: GuessHints;
      revealedAnswer?: RevealedAnswer;
    };

/**
 * Fetches the daily puzzle metadata from the backend.
 * Never leaks the target title, plot, or embedding.
 */
export async function getDailyGame(): Promise<DailyGame> {
  return apiFetch<DailyGame>("/moviegoblin/daily");
}

/**
 * Submits a movie guess to the backend for evaluation.
 * `strict` = only exact catalog titles match (used when the player picked a suggestion).
 */
export async function submitGuess(guess: string, strict = true): Promise<GuessEvaluationResponse> {
  return apiFetch<GuessEvaluationResponse>("/moviegoblin/guess", {
    method: "POST",
    body: JSON.stringify({ guess, strict }),
  });
}

/**
 * Catalog-only autocomplete across all 6,153+ movies (starting from 1 character)
 * plus matching Directors (D), Actors (★), Years (YR), Genres (GN), and Languages (LG).
 */
export async function searchCatalogCombined(
  query: string,
  signal?: AbortSignal
): Promise<SearchCatalogResponse> {
  const q = query.trim();
  if (q.length < 1) return { results: [], attributes: [] };

  // Instant local lookup across all 6,154 catalog movies + attributes
  const local = searchLocalCatalog(q, 40, 8);

  try {
    const data = await apiFetch<{ results?: SearchSuggestion[]; attributes?: AttributeSuggestion[] }>(
      `/moviegoblin/search?q=${encodeURIComponent(q)}`,
      { signal }
    );
    const seenLabels = new Set<string>();
    const mergedResults: SearchSuggestion[] = [];
    for (const item of [...(data.results ?? []), ...local.results]) {
      if (!seenLabels.has(item.label)) {
        seenLabels.add(item.label);
        mergedResults.push(item);
      }
      if (mergedResults.length >= 40) break;
    }

    const seenAttrs = new Set<string>();
    const mergedAttrs: AttributeSuggestion[] = [];
    for (const attr of [...(data.attributes ?? []), ...local.attributes]) {
      const k = `${attr.kind}::${attr.value.toLowerCase()}`;
      if (!seenAttrs.has(k)) {
        seenAttrs.add(k);
        mergedAttrs.push(attr);
      }
      if (mergedAttrs.length >= 8) break;
    }

    return {
      results: mergedResults,
      attributes: mergedAttrs,
    };
  } catch {
    return local;
  }
}

/** Legacy helper returning only movie suggestions. */
export async function searchMovies(query: string, signal?: AbortSignal): Promise<SearchSuggestion[]> {
  const res = await searchCatalogCombined(query, signal);
  return res.results;
}

/** Checks a selected Director, Actor, Year, Genre, or Language against today's secret movie. */
export async function submitAttribute(
  kind: AttributeKind,
  value: string
): Promise<AttributeCheckResult> {
  return apiFetch<AttributeCheckResult>("/moviegoblin/attribute", {
    method: "POST",
    body: JSON.stringify({ kind, value }),
  });
}

/** Fetches the n-th (1-based) progressive clue for today's film. */
export async function getClue(n: number): Promise<Clue> {
  return apiFetch<Clue>(`/moviegoblin/clue?n=${n}`);
}

/** Gives up on today's puzzle and returns the revealed answer. */
export async function giveUp(): Promise<{ revealedAnswer: RevealedAnswer }> {
  return apiFetch<{ revealedAnswer: RevealedAnswer }>("/moviegoblin/giveup", { method: "POST" });
}
