import type { AttributeCheckResult, Clue, GuessHints, RevealedAnswer } from "./client";

export type GuessResult = {
  guess: string;
  matchedTitle?: string;
  /** 0-100 integer match percent, shown as a number. */
  similarity: number;
  similarityLabel: string;
  isCorrect: boolean;
  /** Facts shared with today's film (director / cast / genres / language / year direction). */
  hints?: GuessHints;
};

export type DayState = {
  date: string;           // "YYYY-MM-DD" UTC
  guesses: GuessResult[];
  solved: boolean;
  failed?: boolean;       // Deprecated legacy field; unlimited guesses mean games only complete on solve
  surrendered?: boolean;  // Set when player chooses Give Up
  /** Clues the player has asked for today, in the order revealed. */
  clues?: Clue[];
  /** Direct attribute checks (Director / Actor / Year / Genre / Language). */
  attributeChecks?: AttributeCheckResult[];
  revealedAnswer?: RevealedAnswer;
};
export type Stats = {
  played: number;
  won: number;
  currentStreak: number;
  maxStreak: number;
  lastWonDate: string | null;
};

const DAY_KEY = "wg:day";
const STATS_KEY = "wg:stats";

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function getTodayUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getYesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── localStorage ─────────────────────────────────────────────────────────────

export function loadDayState(expectedDate?: string): DayState {
  const targetDate = expectedDate || getTodayUTC();
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DayState>;
      if (parsed.date === targetDate) {
        return {
          date: targetDate,
          guesses: Array.isArray(parsed.guesses) ? parsed.guesses : [],
          solved: Boolean(parsed.solved),
          surrendered: Boolean(parsed.surrendered),
          clues: Array.isArray(parsed.clues) ? parsed.clues : [],
          attributeChecks: Array.isArray(parsed.attributeChecks) ? parsed.attributeChecks : [],
          revealedAnswer: parsed.revealedAnswer,
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return { date: targetDate, guesses: [], solved: false };
}

export function saveDayState(state: DayState): void {
  try {
    localStorage.setItem(DAY_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw) as Stats;
  } catch {
    // ignore
  }
  return { played: 0, won: 0, currentStreak: 0, maxStreak: 0, lastWonDate: null };
}

export function recordWin(date: string): void {
  const stats = loadStats();
  const yesterday = getYesterdayUTC();
  stats.played += 1;
  stats.won += 1;
  stats.currentStreak = stats.lastWonDate === yesterday ? stats.currentStreak + 1 : 1;
  stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  stats.lastWonDate = date;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

export type { GuessHints, RevealedAnswer, Clue } from "./client";

/** Records a surrendered puzzle: counts as played and ends the current streak. */
export function recordGiveUp(): void {
  const stats = loadStats();
  stats.played += 1;
  stats.currentStreak = 0;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

/**
 * @deprecated Unlimited guesses mean daily games only end upon being solved.
 * Retained as a safe no-op to prevent broken external callers.
 */
export function recordLoss(): void {
  // Unlimited guesses mean games only complete on solve; no loss recorded.
}
