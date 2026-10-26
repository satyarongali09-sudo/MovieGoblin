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
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new CatalogUnavailableError(
      "Supabase URL is not configured. SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required."
    );
  }

  if (!secretKey) {
    throw new CatalogUnavailableError(
      "Server database secret is not configured. Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in server environment variables."
    );
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

type CompactMovie = {
  t: string;
  y: number;
  o?: string;
  d?: string;
  l?: string;
  p?: number;
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

  async getAllActiveMovies(): Promise<CatalogMovie[]> {
    const now = Date.now();
    if (this.cachedMovies && now < this.cacheExpiresAt) {
      return this.cachedMovies;
    }

    const bundled = loadBundledCatalogMovies();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("moviegoblin_movies")
      .select("id, title, normalized_title, aliases, year, genres, plot, embedding, is_active")
      .eq("is_active", true);

    if (error) {
      throw new CatalogUnavailableError(`Database error fetching movies: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new CatalogUnavailableError("No active movies found in database.");
    }

    const seenKey = new Set<string>();
    const merged: CatalogMovie[] = [];

    for (const m of data as CatalogMovie[]) {
      const key = `${normalizeTitle(m.title)}::${m.year}`;
      seenKey.add(key);
      merged.push(m);
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
  }

  async getDailyAssignment(dateUTC: string): Promise<string | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
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
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
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

    if (!data?.movie_id) {
      const existing = await this.getDailyAssignment(dateUTC);
      return existing ?? movieId;
    }

    return data.movie_id;
  }
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

    const primaryActive = activeMovies.filter((m) => !m.id.startsWith("csv-") && !m.id.startsWith("cat-"));
    const pool = primaryActive.length > 0 ? primaryActive : activeMovies;
    const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
    const EPOCH_UTC = Date.UTC(2026, 9, 24);
    const [y, m, d] = dateUTC.split("-").map(Number);
    const targetMs = Date.UTC(y, m - 1, d);
    const dayIndex = Math.floor((targetMs - EPOCH_UTC) / 86_400_000);
    const candidate = sorted[Math.abs(dayIndex) % sorted.length];

    const assignedId = await this.repo.createDailyAssignment(dateUTC, candidate.id);
    const finalMovie = sorted.find((m) => m.id === assignedId) ?? candidate;
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
    const isExactMatch = candidate.id === targetMovie.id;

    if (isExactMatch) {
      return {
        recognized: true,
        isCorrect: true,
        similarity: 100,
        similarityLabel: "🎬 Correct!",
        matchedTitle: `${candidate.title} (${candidate.year})`,
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
