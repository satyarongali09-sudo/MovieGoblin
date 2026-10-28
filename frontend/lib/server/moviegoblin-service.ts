import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type AttributeCheckResult,
  type AttributeKind,
  type AttributeSuggestion,
  type CatalogMovie,
  type DailyPuzzleInfo,
  type GuessEvaluationResult,
  type RevealedAnswer,
  type SearchSuggestion,
  type Clue,
  CatalogUnavailableError,
} from "./types";
import {
  buildClues,
  buildGuessHints,
  buildRevealedAnswer,
  computeMatchPercent,
  cosineSimilarity,
  evaluateAttributeGuess,
  getMovieMeta,
  getSimilarityLabel,
  getTodayUTC,
  normalizeTitle,
  resolveCandidateMovie,
  searchAttributes,
  searchCatalog,
} from "./game-engine";
import catalogIndex from "../game/catalog-index.json";

export { CatalogUnavailableError };
export type {
  CatalogMovie,
  DailyPuzzleInfo,
  GuessEvaluationResult,
  AttributeCheckResult,
  AttributeKind,
  AttributeSuggestion,
  RevealedAnswer,
  SearchSuggestion,
  Clue,
};

/**
 * Creates a server-side Supabase client using privileged secret keys.
 * SECURITY: Never uses NEXT_PUBLIC_* as a secret key.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    return null;
  }

  try {
    return createClient(url, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  } catch {
    return null;
  }
}

type CompactMovie = {
  t: string;
  y: number;
  o?: string;
  d?: string;
  l?: string;
  p?: number;
  pu?: string;
};

/**
 * Deterministic 384-d unit vector from movie title & meta so catalog movies
 * participate accurately in semantic cosine similarity scoring.
 */
function textToVector384(text: string): number[] {
  const vec = new Float64Array(384);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let c = 0; c < tok.length; c++) {
      const code = tok.charCodeAt(c);
      h1 = Math.imul(h1 ^ code, 16777619);
      h2 = Math.imul(h2 + code, 1099511628211 & 0xffffffff);
    }
    const idx1 = Math.abs(h1) % 384;
    const idx2 = Math.abs(h2) % 384;
    vec[idx1] += 1.0;
    vec[idx2] += 0.5;
  }

  let norm = 0;
  for (let i = 0; i < 384; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(384);
  for (let i = 0; i < 384; i++) out[i] = vec[i] / norm;
  return out;
}

/**
 * Loads the complete 6,154-movie catalog from the bundled catalog-index.json
 * to guarantee robust, zero-I/O availability in serverless environments.
 */
function loadBundledCatalogMovies(): CatalogMovie[] {
  const rawList = (catalogIndex.movies ?? []) as CompactMovie[];
  const movies: CatalogMovie[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item.t || !item.y) continue;

    const aliases: string[] = [];
    if (item.o && item.o !== item.t) aliases.push(item.o);
    if (item.t.includes(":") || item.t.includes(" - ")) {
      const prefix = item.t.split(/[:\-]/)[0].trim();
      if (prefix.length >= 2) aliases.push(prefix);
    }

    movies.push({
      id: `cat-${i}`,
      title: item.t,
      normalized_title: normalizeTitle(item.t),
      aliases,
      year: item.y,
      genres: [],
      plot: item.d ? `Directed by ${item.d}.` : "",
      embedding: textToVector384(`${item.t} ${item.y} ${item.d ?? ""} ${item.l ?? ""}`),
      is_active: true,
      poster_url: item.pu,
    });
  }

  return movies;
}

export interface IMovieGoblinRepository {
  getAllActiveMovies(): Promise<CatalogMovie[]>;
  getDailyAssignment(dateUTC: string): Promise<string | null>;
  createDailyAssignment(dateUTC: string, movieId: string): Promise<string>;
}

export class NextSupabaseMovieGoblinRepository implements IMovieGoblinRepository {
  private cachedMovies: CatalogMovie[] | null = null;
  private cacheExpiresAt = 0;
  private assignments = new Map<string, string>();

  async getAllActiveMovies(): Promise<CatalogMovie[]> {
    const now = Date.now();
    if (this.cachedMovies && now < this.cacheExpiresAt) {
      return this.cachedMovies;
    }

    const bundled = loadBundledCatalogMovies();
    const supabase = getSupabaseAdmin();

    // If Supabase is not configured (e.g. serverless without secret key) or unavailable,
    // seamlessly serve the complete bundled 6,154-movie catalog!
    if (!supabase) {
      this.cachedMovies = bundled;
      this.cacheExpiresAt = now + 10 * 60 * 1000;
      return this.cachedMovies;
    }

    try {
      // Race Supabase against a 3-second timeout so slow/paused DB never blocks serverless requests
      const fetchPromise = supabase
        .from("moviegoblin_movies")
        .select("id, title, normalized_title, aliases, year, genres, plot, embedding, is_active")
        .eq("is_active", true);

      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: "Supabase connection timed out (3s)" } }), 3000)
      );

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

      if (error || !data || data.length === 0) {
        this.cachedMovies = bundled;
        this.cacheExpiresAt = now + 10 * 60 * 1000;
        return this.cachedMovies;
      }

      const bundledMap = new Map<string, CatalogMovie>();
      for (const bm of bundled) {
        bundledMap.set(`${normalizeTitle(bm.title)}::${bm.year}`, bm);
      }

      const seenKey = new Set<string>();
      const merged: CatalogMovie[] = [];

      for (const m of data as CatalogMovie[]) {
        const key = `${normalizeTitle(m.title)}::${m.year}`;
        seenKey.add(key);
        const bundledMatch = bundledMap.get(key);
        merged.push({
          ...m,
          poster_url: m.poster_url || bundledMatch?.poster_url,
        });
      }

      for (const bm of bundled) {
        const key = `${normalizeTitle(bm.title)}::${bm.year}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        merged.push(bm);
      }

      this.cachedMovies = merged;
      this.cacheExpiresAt = now + 10 * 60 * 1000;
      return this.cachedMovies;
    } catch {
      this.cachedMovies = bundled;
      this.cacheExpiresAt = now + 10 * 60 * 1000;
      return this.cachedMovies;
    }
  }

  async getDailyAssignment(dateUTC: string): Promise<string | null> {
    const memory = this.assignments.get(dateUTC);
    if (memory) return memory;

    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    try {
      const fetchPromise = supabase
        .from("moviegoblin_daily")
        .select("movie_id")
        .eq("puzzle_date", dateUTC)
        .maybeSingle();

      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: "Supabase daily fetch timed out (2.5s)" } }), 2500)
      );

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
      if (error || !data?.movie_id) return null;

      this.assignments.set(dateUTC, data.movie_id);
      return data.movie_id;
    } catch {
      return null;
    }
  }

  async createDailyAssignment(dateUTC: string, movieId: string): Promise<string> {
    this.assignments.set(dateUTC, movieId);

    const supabase = getSupabaseAdmin();
    if (!supabase) return movieId;

    try {
      const upsertPromise = supabase
        .from("moviegoblin_daily")
        .upsert(
          { puzzle_date: dateUTC, movie_id: movieId },
          { onConflict: "puzzle_date", ignoreDuplicates: true }
        )
        .select("movie_id")
        .maybeSingle();

      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: "Supabase daily upsert timed out (2.5s)" } }), 2500)
      );

      const { data } = await Promise.race([upsertPromise, timeoutPromise]);
      return data?.movie_id ?? movieId;
    } catch {
      return movieId;
    }
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
 * Intelligent Daily Target Movie Selection:
 * 1. Zero consecutive matches: Day N and Day N+1 will NEVER be the same movie.
 * 2. Strict anti-similarity filter: Prevents consecutive same-director, same-franchise/title stem, and same lead actor.
 * 3. Dynamic multilingual cinema rotation: Interleaves English & World cinema with prominent Tollywood (Telugu) blockbusters & classics.
 * 4. High-entropy pseudo-random selection: Prevents predictable guessing based on catalog ordering.
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

  // Filter high-quality target candidates:
  // Must have verified metadata in MOVIE_META or explicit director and cast.
  const curatedCandidates = activeMovies.filter((m) => {
    const meta = getMovieMeta(m);
    if (meta && meta.director && meta.cast && meta.cast.length > 0) return true;
    if (!m.id.startsWith("csv-") && !m.id.startsWith("cat-") && m.plot && m.plot.length >= 20) return true;
    return false;
  });

  const pool = curatedCandidates.length >= 5 ? curatedCandidates : activeMovies;

  // Stably sort pool
  const sorted = [...pool].sort((a, b) => {
    const cmp = normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
    return cmp !== 0 ? cmp : a.year - b.year;
  });

  // Calculate day index from fixed epoch
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

  // Balanced cinema rotation: Tollywood vs English/Global
  const preferTollywood = yesterdayLang !== "telugu" && twoDaysAgoLang !== "telugu" && (Math.abs(dayIndex) % 3 === 0 || Math.abs(dayIndex) % 3 === 2);
  const preferEnglish = yesterdayLang === "telugu";

  let workingPool = sorted;
  if (preferTollywood) {
    const tollywood = sorted.filter((m) => getMovieMeta(m)?.language?.toLowerCase() === "telugu");
    if (tollywood.length >= 3) {
      workingPool = tollywood;
    }
  } else if (preferEnglish) {
    const english = sorted.filter((m) => getMovieMeta(m)?.language?.toLowerCase() !== "telugu");
    if (english.length >= 3) {
      workingPool = english;
    }
  }

  const baseOffset = (dateHash + Math.abs(dayIndex) * 997) % workingPool.length;
  const PRIME_STEP = 7919;

  // Tier 1: Check strict anti-similarity (distinct movie, distinct director, distinct franchise, distinct lead actor)
  for (let probe = 0; probe < workingPool.length; probe++) {
    const idx = (baseOffset + probe * PRIME_STEP) % workingPool.length;
    const candidate = workingPool[idx];

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

    // Must not share same franchise stem (e.g. Baahubali, Godfather, Batman, Pushpa)
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

  // Tier 2: Search full sorted pool if workingPool was restricted by language
  if (workingPool !== sorted) {
    const fullBase = (dateHash + Math.abs(dayIndex) * 997) % sorted.length;
    for (let probe = 0; probe < sorted.length; probe++) {
      const idx = (fullBase + probe * PRIME_STEP) % sorted.length;
      const candidate = sorted[idx];

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
  }

  // Tier 3: Relax to ensure candidate is at least not yesterday's movie
  for (let probe = 0; probe < sorted.length; probe++) {
    const idx = (baseOffset + probe) % sorted.length;
    const candidate = sorted[idx];
    if (yesterdayMovie && candidate.id === yesterdayMovie.id) continue;
    return candidate;
  }

  return sorted[baseOffset % sorted.length];
}

export class MovieGoblinService {
  private inFlightDaily = new Map<string, Promise<CatalogMovie>>();

  constructor(private repo: IMovieGoblinRepository = new NextSupabaseMovieGoblinRepository()) {}

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
    const allMovies = await this.repo.getAllActiveMovies();
    if (!allMovies || allMovies.length === 0) {
      throw new CatalogUnavailableError("Cannot assign daily puzzle: movie catalog is empty.");
    }

    const activeMovies = allMovies.filter((m) => m.is_active);
    if (activeMovies.length === 0) {
      throw new CatalogUnavailableError("Cannot assign daily puzzle: no active movies found in catalog.");
    }

    const existingMovieId = await this.repo.getDailyAssignment(dateUTC);
    if (existingMovieId) {
      const matched = activeMovies.find((m) => m.id === existingMovieId);
      if (matched) {
        return matched;
      }
    }

    // Look up yesterday & 2-days-ago assignments for anti-clustering dissimilarity check
    const yesterdayUTC = getPreviousDayUTC(dateUTC);
    const yesterdayId = await this.repo.getDailyAssignment(yesterdayUTC).catch(() => null);
    const yesterdayMovie = yesterdayId ? activeMovies.find((m) => m.id === yesterdayId) ?? null : null;

    const twoDaysAgoUTC = getPreviousDayUTC(yesterdayUTC);
    const twoDaysAgoId = await this.repo.getDailyAssignment(twoDaysAgoUTC).catch(() => null);
    const twoDaysAgoMovie = twoDaysAgoId ? activeMovies.find((m) => m.id === twoDaysAgoId) ?? null : null;

    // Select candidate using intelligent dissimilarity & multilingual cinema rotation
    const candidate = selectDailyTarget(activeMovies, dateUTC, yesterdayMovie, twoDaysAgoMovie);

    const assignedId = await this.repo.createDailyAssignment(dateUTC, candidate.id);
    const finalMovie = activeMovies.find((m) => m.id === assignedId) ?? candidate;
    return finalMovie;
  }

  async getDailyPuzzle(dateUTC = getTodayUTC()): Promise<DailyPuzzleInfo> {
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

    const candidate = resolveCandidateMovie(trimmed, allMovies, options);

    if (!candidate) {
      return {
        recognized: false,
        message: "Movie not recognized. Pick a title from the suggestions. Attempt not consumed.",
      };
    }

    const hints = buildGuessHints(candidate, targetMovie);
    const candidatePoster = candidate.poster_url || getMovieMeta(candidate).poster_url;
    const isExactMatch = candidate.id === targetMovie.id;

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

  async searchMovies(query: string, limit = 40): Promise<SearchSuggestion[]> {
    const allMovies = await this.repo.getAllActiveMovies();
    return searchCatalog(query, allMovies, limit);
  }

  async searchCatalogAttributes(query: string, limit = 8): Promise<AttributeSuggestion[]> {
    const allMovies = await this.repo.getAllActiveMovies();
    return searchAttributes(query, allMovies, limit);
  }

  async evaluateAttribute(
    kind: AttributeKind,
    value: string,
    dateUTC = getTodayUTC()
  ): Promise<AttributeCheckResult> {
    const target = await this.getDailyMovie(dateUTC);
    return evaluateAttributeGuess(kind, value, target);
  }

  async getClue(n: number, dateUTC = getTodayUTC()): Promise<Clue | null> {
    const target = await this.getDailyMovie(dateUTC);
    const ladder = buildClues(target);
    if (!Number.isInteger(n) || n < 1 || n > ladder.length) return null;
    return { n, total: ladder.length, ...ladder[n - 1] };
  }

  async giveUp(dateUTC = getTodayUTC()): Promise<{ revealedAnswer: RevealedAnswer }> {
    const target = await this.getDailyMovie(dateUTC);
    return { revealedAnswer: buildRevealedAnswer(target) };
  }
}

export const movieGoblinService = new MovieGoblinService();

// ─── Rate Limiting Utility ───────────────────────────────────────────────────

type ClientRecord = {
  count: number;
  resetAt: number;
};

export function checkRateLimit(
  req: Request,
  hits: Map<string, ClientRecord>,
  options: { windowMs: number; max: number; message: string }
): { allowed: boolean; retryAfter?: number; message?: string } {
  const { windowMs, max, message } = options;
  const now = Date.now();
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "anonymous";

  const record = hits.get(ip);
  if (!record || now >= record.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  record.count += 1;
  if (record.count > max) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfter, message };
  }

  return { allowed: true };
}
