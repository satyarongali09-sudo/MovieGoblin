import type { AttributeCheckResult, Clue, GuessHints, RevealedAnswer } from "./client";

export type GuessResult = {
  guess: string;
  matchedTitle?: string;
  poster_url?: string;
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
  /** Whether the player opened/revealed the Case File during active gameplay. */
  caseFileOpened?: boolean;
  revealedAnswer?: RevealedAnswer;
};

export type Stats = {
  played: number;
  won: number;
  currentStreak: number;
  maxStreak: number;
  lastWonDate: string | null;
  totalScore?: number;
  bestScore?: number;
  pureWins?: number;
};

export type ConsoleRank = "S+" | "S" | "A" | "B" | "C" | "F";

export type ScoreBreakdown = {
  total: number;
  baseScore: number;
  efficiencyBonus: number;
  noCaseFileBonus: number;
  noClueBonus: number;
  rank: ConsoleRank;
  rankTitle: string;
  usedCaseFile: boolean;
  cluesUsed: number;
  guessCount: number;
};

const DAY_KEY = "wg:day";
const STATS_KEY = "wg:stats";

// ─── Score Calculation Engine ─────────────────────────────────────────────────

/**
 * Computes the final or projected score breakdown for a daily game.
 * Max possible score: 1,500 PTS (500 Base + 500 1st-Guess Efficiency + 300 No-Case-File Bonus + 200 No-Clue Bonus).
 * If the player chooses the option to hide the case file, they earn the +300 bonus points!
 */
export function computeGameScore(state: DayState, isCaseFileCurrentlyHidden?: boolean): ScoreBreakdown {
  const isHidden = typeof isCaseFileCurrentlyHidden === "boolean" ? isCaseFileCurrentlyHidden : !state.caseFileOpened;
  const usedCaseFile = !isHidden || (state.attributeChecks?.length ?? 0) > 0;
  const cluesUsed = state.clues?.length ?? 0;
  const guessCount = state.guesses.length;

  if (state.surrendered && !state.solved) {
    return {
      total: 0,
      baseScore: 0,
      efficiencyBonus: 0,
      noCaseFileBonus: 0,
      noClueBonus: 0,
      rank: "F",
      rankTitle: "SIGNAL LOST",
      usedCaseFile,
      cluesUsed,
      guessCount,
    };
  }

  const effectiveGuesses = Math.max(1, guessCount);
  const baseScore = 500;
  const efficiencyBonus = Math.max(100, 500 - (effectiveGuesses - 1) * 45);
  const noCaseFileBonus = usedCaseFile ? 0 : 300;
  const noClueBonus = Math.max(0, 200 - cluesUsed * 50);
  const total = baseScore + efficiencyBonus + noCaseFileBonus + noClueBonus;

  let rank: ConsoleRank = "C";
  let rankTitle = "ROOKIE AGENT";
  if (total >= 1350) {
    rank = "S+";
    rankTitle = "APEX ORACLE";
  } else if (total >= 1150) {
    rank = "S";
    rankTitle = "PURE DETECTIVE";
  } else if (total >= 950) {
    rank = "A";
    rankTitle = "CHIEF ARCHIVIST";
  } else if (total >= 750) {
    rank = "B";
    rankTitle = "FIELD OPERATIVE";
  }

  return {
    total,
    baseScore,
    efficiencyBonus,
    noCaseFileBonus,
    noClueBonus,
    rank,
    rankTitle,
    usedCaseFile,
    cluesUsed,
    guessCount,
  };
}

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
    if (typeof window !== "undefined" && (window.location.search.includes("reset") || window.location.search.includes("new"))) {
      localStorage.removeItem(DAY_KEY);
      return { date: targetDate, guesses: [], solved: false, caseFileOpened: false };
    }
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DayState>;
      // If the cached revealed answer was See Spot Run (the old non-Telugu test target),
      // automatically clear it so the player can immediately play today's updated Telugu puzzle!
      if (parsed.revealedAnswer?.title === "See Spot Run") {
        localStorage.removeItem(DAY_KEY);
        return { date: targetDate, guesses: [], solved: false, caseFileOpened: false };
      }
      if (parsed.date === targetDate) {
        return {
          date: targetDate,
          guesses: Array.isArray(parsed.guesses) ? parsed.guesses : [],
          solved: Boolean(parsed.solved),
          surrendered: Boolean(parsed.surrendered),
          clues: Array.isArray(parsed.clues) ? parsed.clues : [],
          attributeChecks: Array.isArray(parsed.attributeChecks) ? parsed.attributeChecks : [],
          caseFileOpened: Boolean(parsed.caseFileOpened),
          revealedAnswer: parsed.revealedAnswer,
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return { date: targetDate, guesses: [], solved: false, caseFileOpened: false };
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
    if (raw) {
      const parsed = JSON.parse(raw) as Stats;
      return {
        played: parsed.played ?? 0,
        won: parsed.won ?? 0,
        currentStreak: parsed.currentStreak ?? 0,
        maxStreak: parsed.maxStreak ?? 0,
        lastWonDate: parsed.lastWonDate ?? null,
        totalScore: parsed.totalScore ?? 0,
        bestScore: parsed.bestScore ?? 0,
        pureWins: parsed.pureWins ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastWonDate: null,
    totalScore: 0,
    bestScore: 0,
    pureWins: 0,
  };
}

export function recordWin(date: string, score = 0, isPureWin = false): void {
  const stats = loadStats();
  const yesterday = getYesterdayUTC();
  stats.played += 1;
  stats.won += 1;
  stats.currentStreak = stats.lastWonDate === yesterday ? stats.currentStreak + 1 : 1;
  stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  stats.lastWonDate = date;
  stats.totalScore = (stats.totalScore ?? 0) + score;
  stats.bestScore = Math.max(stats.bestScore ?? 0, score);
  if (isPureWin) {
    stats.pureWins = (stats.pureWins ?? 0) + 1;
  }
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
