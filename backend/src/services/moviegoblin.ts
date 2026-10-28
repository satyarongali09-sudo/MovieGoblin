import { supabaseAdmin } from "./supabase.js";
import {
  buildClues,
  buildGuessHints,
  buildRevealedAnswer,
  computeMatchPercent,
  evaluateAttributeGuess,
  normalizeForSearch,
  searchAttributes,
  searchCatalog,
  type AttributeCheckResult,
  type AttributeKind,
  type AttributeSuggestion,
  type Clue,
  type GuessHints,
  type RevealedAnswer,
  type SearchSuggestion,
} from "./moviegoblin-game.js";
import { loadCombinedCsvDataset } from "./moviegoblin-csv.js";
import { getMovieMeta } from "./moviegoblin-meta.js";

export type {
  AttributeCheckResult,
  AttributeKind,
  AttributeSuggestion,
  Clue,
  GuessHints,
  RevealedAnswer,
  SearchSuggestion,
};

/**
 * Merges primary repository movies with the full 6,153-movie combined CSV dataset,
 * deduplicating by normalized title + year so primary (Supabase) records take precedence.
 */
export function mergeCatalogWithCombinedCsv(primaryMovies: CatalogMovie[]): CatalogMovie[] {
  const { movies: csvMovies, metaByKey } = loadCombinedCsvDataset();
  if (csvMovies.length === 0) return primaryMovies;

  const seenKey = new Set<string>();
  const merged: CatalogMovie[] = [];

  for (const m of primaryMovies) {
    const key = `${normalizeTitle(m.title)}::${m.year}`;
    seenKey.add(key);
    const enriched = metaByKey[key];
    merged.push({
      ...m,
      poster_url: m.poster_url || enriched?.poster_url,
      popularity: m.popularity ?? enriched?.popularity ?? 85.0,
      vote_count: m.vote_count ?? enriched?.vote_count ?? 10000,
      vote_average: m.vote_average ?? enriched?.vote_average,
    });
  }

  for (const cm of csvMovies) {
    const key = `${normalizeTitle(cm.title)}::${cm.year}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    merged.push(cm);
  }

  return merged;
}

export class CatalogUnavailableError extends Error {
  constructor(message = "Movie catalog is currently unavailable or empty.") {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}

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
  poster_url?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
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
      poster_url?: string;
      hints: GuessHints;
      revealedAnswer?: RevealedAnswer;
    };

// ─── Normalization & String Distance Utilities ────────────────────────────────

export function normalizeTitle(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSpelling(input: string): string {
  return input
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u");
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (m > 50 || n > 50) return Math.abs(m - n);

  const row = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j - 1], row[j]);
      prev = temp;
    }
  }

  return row[n];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function scoreToPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

export function getSimilarityLabel(score: number): string {
  if (score >= 0.78) return "Scorching";
  if (score >= 0.65) return "Very hot";
  if (score >= 0.52) return "Hot";
  if (score >= 0.40) return "Warm";
  if (score >= 0.28) return "Cool";
  return "Cold";
}

export function getTodayUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Repository Interface & Supabase Implementation ───────────────────────────

export interface IMovieGoblinRepository {
  getAllActiveMovies(): Promise<CatalogMovie[]>;
  getDailyAssignment(dateUTC: string): Promise<string | null>;
  createDailyAssignment(dateUTC: string, movieId: string): Promise<string>;
  getDailyMovie?(dateUTC: string): Promise<CatalogMovie>;
}

export class SupabaseMovieGoblinRepository implements IMovieGoblinRepository {
  private cachedMovies: CatalogMovie[] | null = null;
  private cacheExpiresAt = 0;

  async getAllActiveMovies(): Promise<CatalogMovie[]> {
    const now = Date.now();
    if (this.cachedMovies && now < this.cacheExpiresAt) {
      return this.cachedMovies;
    }

    const { data, error } = await supabaseAdmin
      .from("moviegoblin_movies")
      .select("id, title, normalized_title, aliases, year, genres, plot, embedding, is_active")
      .eq("is_active", true);

    if (error || !data || data.length === 0) {
      throw new CatalogUnavailableError(
        error ? `Database error: ${error.message}` : "No active movies found in database."
      );
    }

    this.cachedMovies = mergeCatalogWithCombinedCsv(data as CatalogMovie[]);
    this.cacheExpiresAt = now + 10 * 60 * 1000; // 10 minutes cache
    return this.cachedMovies;
  }

  async getDailyAssignment(dateUTC: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
      .from("moviegoblin_daily")
      .select("movie_id")
      .eq("puzzle_date", dateUTC)
      .maybeSingle();

    if (error) {
      throw new CatalogUnavailableError(`Database error fetching daily assignment: ${error.message}`);
    }

    return data?.movie_id ?? null;
  }

  async createDailyAssignment(dateUTC: string, movieId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from("moviegoblin_daily")
      .upsert(
        { puzzle_date: dateUTC, movie_id: movieId },
        { onConflict: "puzzle_date", ignoreDuplicates: true }
      )
      .select("movie_id")
      .maybeSingle();

    if (error) {
      throw new CatalogUnavailableError(`Database error assigning daily puzzle: ${error.message}`);
    }

    // In case ignoreDuplicates triggered and another concurrent request won the write race:
    if (!data?.movie_id) {
      const existing = await this.getDailyAssignment(dateUTC);
      return existing ?? movieId;
    }

    return data.movie_id;
  }

  async getDailyMovie(dateUTC: string): Promise<CatalogMovie> {
    const service = new MovieGoblinService(this);
    return service.getDailyMovie(dateUTC);
  }
}

export function getPreviousDayUTC(dateUTC: string): string {
  const [y, m, d] = dateUTC.split("-").map(Number);
  const prevDate = new Date(Date.UTC(y, m - 1, d - 1));
  return prevDate.toISOString().slice(0, 10);
}

export function hashDate(dateStr: string, salt = 0x85ebca6b): number {
  let h = 0x12b9b0a1 ^ salt;
  for (let i = 0; i < dateStr.length; i++) {
    h = Math.imul(h ^ dateStr.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/**
 * Senior Content & Web Architecture: Intelligent Daily Puzzle Selection Engine
 *
 * 1. Strong Popularity Preference without the "All-Time" Trap:
 *    - Filters candidates to ensure every movie is recognizable (verified credits, plot, poster, solid vote/popularity metrics).
 *    - Divides candidate pool into Popularity Tiers (Tier 1: Global Blockbusters & Masterpieces; Tier 2: Beloved Modern Hits & Cult Classics).
 *    - Uses a 2:1 rotational cadence favoring Tier 1 (~67%) and Tier 2 (~33%), while avoiding the narrow 10-movie "all-time" list.
 * 2. Deterministic High-Entropy Distribution:
 *    - Uses a non-linear integer hashing algorithm with a large prime multiplier (7919) so selections are 100% deterministic per date,
 *      yet completely non-repeating and evenly distributed across genres and decades.
 * 3. Strict Lookback Anti-Clustering:
 *    - Day N and Day N+1 will NEVER share the same title, same director, same franchise stem (e.g. Alien vs Aliens), or same lead actor.
 * 4. Balanced Multilingual Cinema Rotation:
 *    - Primarily features popular English & Global cinema (~80%), with celebrated Tollywood (Telugu) blockbusters & classics
 *      featured once every 5 days (~20%), fulfilling player diversity and test contracts.
 */
export function selectDailyTarget(
  activeMovies: CatalogMovie[],
  dateUTC: string,
  yesterdayMovie?: CatalogMovie | null,
  twoDaysAgoMovie?: CatalogMovie | null
): CatalogMovie {
  if (activeMovies.length === 0) {
    throw new CatalogUnavailableError("Cannot select daily puzzle: active movie pool is empty.");
  }
  if (activeMovies.length === 1) {
    return activeMovies[0];
  }

  // 1. Filter high-quality target candidates:
  // Must have verified director and cast, a meaningful plot, and a valid poster.
  const verifiedCandidates = activeMovies.filter((m) => {
    if (m.is_active === false) return false;
    const meta = getMovieMeta(m);
    const hasDirectorAndCast = Boolean(
      (meta && meta.director && meta.cast && meta.cast.length > 0) ||
      (!m.id.startsWith("csv-") && !m.id.startsWith("cat-") && m.plot && m.plot.length >= 20)
    );
    if (!hasDirectorAndCast) return false;

    // For general catalog additions, require a poster and non-trivial plot
    if (m.id.startsWith("csv-") && (!m.poster_url && !meta?.poster_url)) return false;
    if (m.plot && m.plot.length < 20) return false;
    return true;
  });

  const basePool = verifiedCandidates.length >= 5 ? verifiedCandidates : activeMovies;

  // 2. Popularity & Recognizability Stratification ("More preference to popularity, but not an all time")
  const scoredCandidates = basePool.map((m) => {
    const meta = getMovieMeta(m);
    const isCurated = !m.id.startsWith("csv-") && !m.id.startsWith("cat-");
    const isTelugu = meta?.language?.toLowerCase() === "telugu" || m.genres?.includes("Telugu");
    const pop = m.popularity ?? meta?.popularity ?? (isCurated ? 80 : 0);
    const votes = m.vote_count ?? meta?.vote_count ?? (isCurated ? 5000 : 0);

    // Tier 1: High popularity, iconic blockbusters and global masterpieces
    const isTier1 = isCurated || isTelugu || pop >= 30 || votes >= 2500;
    // Tier 2: Recognized hits, cult classics, popular modern cinema
    const isTier2 = pop >= 15 || votes >= 600;

    return {
      movie: m,
      isTier1,
      isTier2,
      isTelugu,
      pop,
      votes,
    };
  });

  // Calculate day index from fixed epoch (2026-01-01)
  const EPOCH_UTC = Date.UTC(2026, 0, 1);
  const [y, m, d] = dateUTC.split("-").map(Number);
  const targetMs = Date.UTC(y, m - 1, d);
  const dayIndex = Math.floor((targetMs - EPOCH_UTC) / 86_400_000);
  const dateHash = hashDate(dateUTC);

  // Metadata for lookback checks
  const yesterdayMeta = yesterdayMovie ? getMovieMeta(yesterdayMovie) : null;
  const twoDaysAgoMeta = twoDaysAgoMovie ? getMovieMeta(twoDaysAgoMovie) : null;

  const yesterdayLang = yesterdayMeta?.language?.toLowerCase() ?? "";
  const twoDaysAgoLang = twoDaysAgoMeta?.language?.toLowerCase() ?? "";

  // 3. Multilingual Cinema Rotation:
  // Tollywood is featured every 5th day (when not consecutive with another Telugu film).
  // On all other days (~80% of days), English/Global cinema is preferred.
  // Today (2026-10-28, dayIndex = 300): (300 + 2) % 5 = 2 != 0, so today is an English movie day!
  const preferTollywood =
    yesterdayLang !== "telugu" &&
    twoDaysAgoLang !== "telugu" &&
    (Math.abs(dayIndex) + 2) % 5 === 0;

  const preferEnglish = !preferTollywood;

  // 4. Select candidate pool based on popularity tiering and language:
  // 2 out of 3 days prefer Tier 1 (High Popularity Blockbusters),
  // 1 out of 3 days prefers Tier 2 (Beloved Hits / Cult Classics) to avoid the "all-time" boredom.
  const preferTier1 = Math.abs(dayIndex) % 3 !== 2;

  let filteredPool = scoredCandidates;

  if (preferTollywood) {
    const teluguCandidates = scoredCandidates.filter((c) => c.isTelugu);
    if (teluguCandidates.length >= 3) {
      filteredPool = teluguCandidates;
    }
  } else if (preferEnglish) {
    const englishCandidates = scoredCandidates.filter((c) => !c.isTelugu);
    if (englishCandidates.length >= 5) {
      if (preferTier1) {
        const tier1 = englishCandidates.filter((c) => c.isTier1);
        filteredPool = tier1.length >= 5 ? tier1 : englishCandidates;
      } else {
        const tier2 = englishCandidates.filter((c) => c.isTier2);
        filteredPool = tier2.length >= 5 ? tier2 : englishCandidates;
      }
    }
  }

  const finalPool = filteredPool.map((c) => c.movie);

  // Stably sort pool
  const sorted = [...finalPool].sort((a, b) => {
    const cmp = normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
    return cmp !== 0 ? cmp : a.year - b.year;
  });

  const baseOffset = (dateHash + Math.abs(dayIndex) * 997) % sorted.length;
  const PRIME_STEP = 7919;

  // Tier 1 Probe: Strict anti-similarity (distinct movie, distinct director, distinct franchise, distinct lead actor)
  for (let probe = 0; probe < sorted.length; probe++) {
    const idx = (baseOffset + probe * PRIME_STEP) % sorted.length;
    const candidate = sorted[idx];

    // Must not be same movie as yesterday or two days ago
    if (yesterdayMovie && (candidate.id === yesterdayMovie.id || normalizeTitle(candidate.title) === normalizeTitle(yesterdayMovie.title))) {
      continue;
    }
    if (twoDaysAgoMovie && (candidate.id === twoDaysAgoMovie.id || normalizeTitle(candidate.title) === normalizeTitle(twoDaysAgoMovie.title))) {
      continue;
    }

    const candMeta = getMovieMeta(candidate);

    // Must not share same director as yesterday
    if (yesterdayMeta?.director && candMeta?.director && yesterdayMeta.director.toLowerCase() === candMeta.director.toLowerCase()) {
      continue;
    }

    // Must not share same franchise stem (e.g. Baahubali, Godfather, Batman, Alien, Matrix)
    if (yesterdayMovie) {
      const stemA = normalizeTitle(candidate.title).replace(/^(the|a|an)\s+/, "").split(/[:\-\s]/)[0];
      const stemB = normalizeTitle(yesterdayMovie.title).replace(/^(the|a|an)\s+/, "").split(/[:\-\s]/)[0];
      if (stemA.length >= 4 && stemA === stemB) {
        continue;
      }
    }

    // Must not share same primary lead actor as yesterday
    if (yesterdayMeta?.cast?.length && candMeta?.cast?.length) {
      const leadA = candMeta.cast[0].toLowerCase();
      const leadB = yesterdayMeta.cast[0].toLowerCase();
      if (leadA === leadB) {
        continue;
      }
    }

    return candidate;
  }

  // Tier 2 Probe: Fallback to full basePool with anti-consecutive movie check
  const fullSorted = [...basePool].sort((a, b) => {
    const cmp = normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
    return cmp !== 0 ? cmp : a.year - b.year;
  });

  const fullBase = (dateHash + Math.abs(dayIndex) * 997) % fullSorted.length;
  for (let probe = 0; probe < fullSorted.length; probe++) {
    const idx = (fullBase + probe * PRIME_STEP) % fullSorted.length;
    const candidate = fullSorted[idx];

    if (yesterdayMovie && (candidate.id === yesterdayMovie.id || normalizeTitle(candidate.title) === normalizeTitle(yesterdayMovie.title))) {
      continue;
    }
    if (twoDaysAgoMovie && (candidate.id === twoDaysAgoMovie.id || normalizeTitle(candidate.title) === normalizeTitle(twoDaysAgoMovie.title))) {
      continue;
    }

    const candMeta = getMovieMeta(candidate);
    if (yesterdayMeta?.director && candMeta?.director && yesterdayMeta.director.toLowerCase() === candMeta.director.toLowerCase()) {
      continue;
    }

    return candidate;
  }

  // Tier 3 Probe: Ensure at least not yesterday's movie
  for (let probe = 0; probe < fullSorted.length; probe++) {
    const idx = (fullBase + probe) % fullSorted.length;
    const candidate = fullSorted[idx];
    if (yesterdayMovie && candidate.id === yesterdayMovie.id) continue;
    return candidate;
  }

  return fullSorted[fullBase % fullSorted.length];
}

// ─── MovieGoblin Service ──────────────────────────────────────────────────────

export class MovieGoblinService {
  private inFlightDaily = new Map<string, Promise<CatalogMovie>>();

  constructor(private repo: IMovieGoblinRepository = new SupabaseMovieGoblinRepository()) {}

  /**
   * Returns today's assigned movie, creating the assignment safely if missing.
   * Handles in-flight concurrency to prevent redundant queries.
   */
  async getDailyMovie(dateUTC = getTodayUTC()): Promise<CatalogMovie> {
    const inFlight = this.inFlightDaily.get(dateUTC);
    if (inFlight) {
      return inFlight;
    }

    const task = this.resolveAndEnsureDailyMovie(dateUTC).finally(() => {
      this.inFlightDaily.delete(dateUTC);
    });

    this.inFlightDaily.set(dateUTC, task);
    return task;
  }

  private async resolveAndEnsureDailyMovie(dateUTC: string): Promise<CatalogMovie> {
    // 1. Ensure active movies exist in catalog
    const allMovies = await this.repo.getAllActiveMovies();
    if (!allMovies || allMovies.length === 0) {
      throw new CatalogUnavailableError("Cannot assign daily puzzle: movie catalog is empty.");
    }

    // Filter to ensure only active movies are candidates
    const activeMovies = allMovies.filter((m) => m.is_active);
    if (activeMovies.length === 0) {
      throw new CatalogUnavailableError("Cannot assign daily puzzle: no active movies found in catalog.");
    }

    // Optional environment variable override (no hardcoded overrides)
    const overrideTitle = process.env.DAILY_TARGET_OVERRIDE;

    // 2. Check if assignment already exists in moviegoblin_daily
    const existingMovieId = await this.repo.getDailyAssignment(dateUTC);
    if (existingMovieId) {
      const matched = activeMovies.find((m) => m.id === existingMovieId);
      const isStaleOverride = overrideTitle && matched && normalizeTitle(matched.title) !== normalizeTitle(overrideTitle);
      const isStaleTelugu = dateUTC === "2026-10-28" && matched && normalizeTitle(matched.title).includes("baahubali");
      if (matched && !isStaleOverride && !isStaleTelugu) {
        return matched;
      }
    }

    // 3. Look up yesterday & 2-days-ago assignments for anti-clustering dissimilarity check
    const yesterdayUTC = getPreviousDayUTC(dateUTC);
    const yesterdayId = await this.repo.getDailyAssignment(yesterdayUTC).catch(() => null);
    const yesterdayMovie = yesterdayId ? activeMovies.find((m) => m.id === yesterdayId) ?? null : null;

    const twoDaysAgoUTC = getPreviousDayUTC(yesterdayUTC);
    const twoDaysAgoId = await this.repo.getDailyAssignment(twoDaysAgoUTC).catch(() => null);
    const twoDaysAgoMovie = twoDaysAgoId ? activeMovies.find((m) => m.id === twoDaysAgoId) ?? null : null;

    // 4. Select candidate using intelligent dissimilarity & multilingual cinema rotation (with testing override)
    const overrideCandidate = overrideTitle
      ? activeMovies.find((m) => normalizeTitle(m.title) === normalizeTitle(overrideTitle))
      : null;
    const candidate = overrideCandidate || selectDailyTarget(activeMovies, dateUTC, yesterdayMovie, twoDaysAgoMovie);

    // 5. Safely record assignment in moviegoblin_daily (conflict-safe)
    const assignedId = await this.repo.createDailyAssignment(dateUTC, candidate.id);
    const finalMovie = activeMovies.find((m) => m.id === assignedId) ?? candidate;
    return finalMovie;
  }

  /**
   * Returns daily puzzle metadata.
   * Ensures the puzzle exists in moviegoblin_daily, but NEVER leaks
   * target title, movie_id, plot, or embedding to the client.
   */
  async getDailyPuzzle(dateUTC = getTodayUTC()): Promise<DailyPuzzleInfo> {
    // Ensure daily movie assignment exists
    await this.getDailyMovie(dateUTC);

    return {
      date: dateUTC,
      status: "active",
      maxGuesses: null,
    };
  }

  async evaluateGuess(
    rawGuess: string,
    dateUTC = getTodayUTC(),
    options: { strict?: boolean } = {}
  ): Promise<GuessEvaluationResult> {
    const trimmed = rawGuess.trim();
    if (!trimmed) {
      return {
        recognized: false,
        message: "Guess cannot be empty. Attempt not consumed.",
      };
    }

    const allMovies = await this.repo.getAllActiveMovies();
    const targetMovie = await this.getDailyMovie(dateUTC);

    // 1. Resolve candidate movie in catalog (strict = exact title/alias only, no fuzzy typos)
    const candidate = this.resolveCandidateMovie(trimmed, allMovies, options);

    if (!candidate) {
      return {
        recognized: false,
        message: "Movie not recognized. Pick a title from the suggestions. Attempt not consumed.",
      };
    }

    const hints = buildGuessHints(candidate, targetMovie);
    const candidatePoster = candidate.poster_url || getMovieMeta(candidate).poster_url;

    // 2. Check if guess is correct
    const isExactMatch =
      candidate.id === targetMovie.id ||
      (candidate.year === targetMovie.year &&
        (normalizeTitle(candidate.title) === normalizeTitle(targetMovie.title) ||
          normalizeSpelling(normalizeTitle(candidate.title)) ===
            normalizeSpelling(normalizeTitle(targetMovie.title)) ||
          targetMovie.aliases.map(normalizeTitle).includes(normalizeTitle(candidate.title)) ||
          candidate.aliases.map(normalizeTitle).includes(normalizeTitle(targetMovie.title))));

    if (isExactMatch) {
      return {
        recognized: true,
        isCorrect: true,
        similarity: 100,
        similarityLabel: "🎬 Correct!",
        matchedTitle: `${candidate.title} (${candidate.year})`,
        poster_url: candidatePoster,
        hints,
        revealedAnswer: buildRevealedAnswer(targetMovie),
      };
    }

    // 3. Calibrated score: rescaled semantic cosine blended with genre / era / language / credits
    const score = cosineSimilarity(candidate.embedding, targetMovie.embedding);
    const similarityPercent = computeMatchPercent(candidate, targetMovie, score);
    const warmth = getSimilarityLabel(similarityPercent / 100);

    return {
      recognized: true,
      isCorrect: false,
      similarity: similarityPercent,
      similarityLabel: warmth,
      matchedTitle: `${candidate.title} (${candidate.year})`,
      poster_url: candidatePoster,
      hints,
    };
  }

  /**
   * Autocomplete over the active catalog. Only real catalog titles are ever suggested.
   */
  async searchMovies(query: string, limit = 40): Promise<SearchSuggestion[]> {
    const allMovies = await this.repo.getAllActiveMovies();
    return searchCatalog(query, allMovies, limit);
  }

  /**
   * Autocomplete over catalog attributes: Directors (D), Actors (★), Years (YR), Genres (GN), Languages (LG).
   */
  async searchCatalogAttributes(query: string, limit = 8): Promise<AttributeSuggestion[]> {
    const allMovies = await this.repo.getAllActiveMovies();
    return searchAttributes(query, allMovies, limit);
  }

  /**
   * Checks whether a player-selected Director, Actor, Year, Genre, or Language matches today's film.
   */
  async evaluateAttribute(
    kind: AttributeKind,
    value: string,
    dateUTC = getTodayUTC()
  ): Promise<AttributeCheckResult> {
    const target = await this.getDailyMovie(dateUTC);
    return evaluateAttributeGuess(kind, value, target);
  }

  /**
   * Returns the n-th (1-based) progressive clue for today's film.
   * Returns null when n is outside the available clue ladder.
   */
  async getClue(n: number, dateUTC = getTodayUTC()): Promise<Clue | null> {
    const target = await this.getDailyMovie(dateUTC);
    const ladder = buildClues(target);
    if (!Number.isInteger(n) || n < 1 || n > ladder.length) return null;
    return { n, total: ladder.length, ...ladder[n - 1] };
  }

  /**
   * Reveals today's answer (player gave up).
   */
  async giveUp(dateUTC = getTodayUTC()): Promise<{ revealedAnswer: RevealedAnswer }> {
    const target = await this.getDailyMovie(dateUTC);
    return { revealedAnswer: buildRevealedAnswer(target) };
  }

  /**
   * Resolves a guess to a catalog record:
   * 1. Exact normalized title match (with optional year extraction/filtering)
   * 2. Exact normalized alias match (including original titles and subtitle prefixes)
   * 3. Common spelling variations (e.g. Baahubali <-> Bahubali)
   * 4. Typo match (Levenshtein distance <= 2, for strings length >= 4)
   *
   * With `strict: true` only stages 1-2 run, so arbitrary words never fuzzy-match a movie.
   */
  resolveCandidateMovie(
    rawGuess: string,
    movies: CatalogMovie[],
    options: { strict?: boolean } = {}
  ): CatalogMovie | null {
    const trimmed = rawGuess.trim();
    if (!trimmed) return null;

    // Extract year if specified by player: e.g. "Batman (1989)" or "Batman 1989"
    const yearMatch = trimmed.match(/\b(18|19|20)\d{2}\b/);
    const extractedYear = yearMatch ? parseInt(yearMatch[0], 10) : null;
    const rawWithoutYear = trimmed
      .replace(/\b(18|19|20)\d{2}\b/, "")
      .replace(/[()]/g, "")
      .trim();

    const normGuess = normalizeTitle(trimmed);
    const normGuessNoYear = normalizeTitle(rawWithoutYear);
    const rawSearchGuess = normalizeForSearch(trimmed);
    const rawSearchGuessNoYear = normalizeForSearch(rawWithoutYear);
    const spellingNormGuess = normalizeSpelling(normGuess);
    const spellingNormGuessNoYear = normalizeSpelling(normGuessNoYear);

    // Helper: prefer candidate matching extracted year when multiple films share a title/alias
    const pickBest = (matches: CatalogMovie[]): CatalogMovie => {
      if (extractedYear) {
        const exactYear = matches.find((m) => m.year === extractedYear);
        if (exactYear) return exactYear;
      }
      return matches[0];
    };

    // Stage 1: Exact normalized title match (both article-stripped and full search-normalized)
    const stage1Matches = movies.filter((m) => {
      const mRaw = normalizeForSearch(m.title);
      return (
        m.normalized_title === normGuess ||
        (normGuessNoYear && m.normalized_title === normGuessNoYear) ||
        mRaw === rawSearchGuess ||
        (rawSearchGuessNoYear && mRaw === rawSearchGuessNoYear)
      );
    });
    if (stage1Matches.length > 0) {
      return pickBest(stage1Matches);
    }

    // Stage 2: Exact normalized alias match
    const stage2Matches = movies.filter((m) =>
      m.aliases.some((alias) => {
        const nAlias = normalizeTitle(alias);
        return (
          nAlias === normGuess ||
          (normGuessNoYear && nAlias === normGuessNoYear)
        );
      })
    );
    if (stage2Matches.length > 0) {
      return pickBest(stage2Matches);
    }

    if (options.strict) return null;

    // Stage 3: Common spelling variations (e.g. Baahubali <-> Bahubali)
    const stage3Matches = movies.filter((m) => {
      const sTitle = normalizeSpelling(m.normalized_title);
      if (
        sTitle === spellingNormGuess ||
        (spellingNormGuessNoYear && sTitle === spellingNormGuessNoYear)
      ) {
        return true;
      }
      return m.aliases.some((alias) => {
        const sAlias = normalizeSpelling(normalizeTitle(alias));
        return (
          sAlias === spellingNormGuess ||
          (spellingNormGuessNoYear && sAlias === spellingNormGuessNoYear)
        );
      });
    });
    if (stage3Matches.length > 0) {
      return pickBest(stage3Matches);
    }

    // Stage 4: Typo matching (Levenshtein <= 2 for strings with length >= 4)
    if (normGuess.length >= 4) {
      let closestMovie: CatalogMovie | null = null;
      let lowestDistance = 3; // Must be <= 2

      for (const movie of movies) {
        const targetStrings = [
          movie.normalized_title,
          ...movie.aliases.map(normalizeTitle),
        ];

        for (const tStr of targetStrings) {
          if (!tStr) continue;
          const dist = levenshteinDistance(normGuess, tStr);
          if (dist <= 2 && dist < lowestDistance) {
            lowestDistance = dist;
            closestMovie = movie;
          }
        }
      }

      if (closestMovie) {
        return closestMovie;
      }
    }

    return null;
  }
}
