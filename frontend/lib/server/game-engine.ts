import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  type AttributeCheckResult,
  type AttributeKind,
  type AttributeSuggestion,
  type CatalogMovie,
  type Clue,
  type GuessHints,
  type RevealedAnswer,
  type SearchSuggestion,
  type YearRelation,
} from "./types";
import { MOVIE_META, type MovieMeta } from "./movie-meta";
import catalogIndex from "../game/catalog-index.json";

// ─── Normalization & Math Utilities ──────────────────────────────────────────

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

export function normalizeForSearch(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normPerson(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map((s) => s.toLowerCase()));
  const B = new Set(b.map((s) => s.toLowerCase()));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ─── Metadata Lookup with Catalog-Index & Optional CSV ────────────────────────

export function metaKey(title: string, year: number): string {
  return `${normalizeTitle(title)}::${year}`;
}

const catalogMap = new Map<string, { t: string; y: number; d?: string; l?: string; o?: string }>();
for (const m of (catalogIndex.movies ?? []) as Array<{ t: string; y: number; d?: string; l?: string; o?: string }>) {
  if (m.t && m.y) {
    catalogMap.set(metaKey(m.t, m.y), m);
  }
}

// Optional CSV cache (populated once if file exists in runtime environment)
let csvMetaByKey: Record<string, MovieMeta> | null = null;

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    if (row.some((v) => v.trim())) rows.push(row);
  }
  return rows;
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  te: "Telugu",
  hi: "Hindi",
  ta: "Tamil",
  ml: "Malayalam",
  kn: "Kannada",
  fr: "French",
  ja: "Japanese",
  es: "Spanish",
  de: "German",
  it: "Italian",
  ko: "Korean",
  zh: "Chinese",
  ru: "Russian",
  pt: "Portuguese",
};

function languageName(code: string): string | undefined {
  const clean = code.trim().toLowerCase();
  if (!clean) return undefined;
  if (LANG_NAMES[clean]) return LANG_NAMES[clean];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(clean) ?? undefined;
  } catch {
    return undefined;
  }
}

function loadCsvMetaIfNeeded(): Record<string, MovieMeta> {
  if (csvMetaByKey) return csvMetaByKey;
  csvMetaByKey = {};

  try {
    const candidates = [
      resolve(process.cwd(), "wordgoblin_movies_combined.csv"),
      resolve(process.cwd(), "..", "wordgoblin_movies_combined.csv"),
    ];
    let csvPath: string | null = null;
    for (const p of candidates) {
      if (existsSync(p)) {
        csvPath = p;
        break;
      }
    }

    if (csvPath) {
      const raw = readFileSync(csvPath, "utf-8").replace(/^\ufeff/, "");
      const rows = parseCSV(raw);
      if (rows.length > 1) {
        const header = rows[0].map((h) => h.trim());
        const idx = (name: string) => header.indexOf(name);
        const iTitle = idx("title");
        const iOrig = idx("original_title");
        const iYear = idx("year");
        const iLang = idx("language");
        const iKeywords = idx("keywords");
        const iDirector = idx("director");
        const iCast = idx("cast");
        const iRating = idx("rating");
        const iRuntime = idx("runtime");

        for (let r = 1; r < rows.length; r++) {
          const cols = rows[r];
          const title = (cols[iTitle] || "").trim();
          if (!title) continue;

          const parsedYear = parseInt((cols[iYear] || "").trim(), 10);
          const year = !isNaN(parsedYear) && parsedYear >= 1888 && parsedYear <= 2100 ? parsedYear : 0;
          if (year === 0) continue;

          const baseNorm = normalizeTitle(title);
          if (!baseNorm) continue;
          const dedupKey = `${baseNorm}::${year}`;

          const origTitle = (cols[iOrig] || "").trim();
          const keywordsRaw = (cols[iKeywords] || "").trim();
          const keywords = keywordsRaw
            ? keywordsRaw.split(/[|,]/).map((k) => k.trim()).filter(Boolean)
            : [];
          const director = (cols[iDirector] || "").split("|")[0]?.trim() || undefined;
          const cast = (cols[iCast] || "")
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 6);
          const lang = languageName(cols[iLang] || "");
          const ratingVal = parseFloat(cols[iRating] || "");
          const rating = !isNaN(ratingVal) && ratingVal > 0 ? ratingVal : undefined;
          const runtimeVal = Math.round(parseFloat(cols[iRuntime] || ""));
          const runtime = runtimeVal > 0 ? runtimeVal : undefined;

          csvMetaByKey[dedupKey] = {
            ...(director ? { director } : {}),
            cast,
            ...(lang ? { language: lang } : {}),
            ...(runtime ? { runtime } : {}),
            ...(rating ? { rating } : {}),
            ...(keywords.length ? { keywords } : {}),
            ...(origTitle && origTitle !== title ? { originalTitle: origTitle } : {}),
          };
        }
      }
    }
  } catch {
    // Graceful fallback to catalogMap and MOVIE_META
  }

  return csvMetaByKey;
}

const EMPTY_META: MovieMeta = { cast: [] };

export function getMovieMeta(movie: { title: string; year: number }): MovieMeta {
  const key = metaKey(movie.title, movie.year);
  const curated = MOVIE_META[key];
  const csvMeta = loadCsvMetaIfNeeded()[key];
  const catItem = catalogMap.get(key);

  const fallbackMeta: MovieMeta = {
    cast: [],
    ...(catItem?.d ? { director: catItem.d } : {}),
    ...(catItem?.l ? { language: catItem.l } : {}),
    ...(catItem?.o ? { originalTitle: catItem.o } : {}),
  };

  const baseMeta: MovieMeta = csvMeta
    ? {
        ...fallbackMeta,
        ...csvMeta,
        cast: csvMeta.cast?.length ? csvMeta.cast : fallbackMeta.cast,
        director: csvMeta.director ?? fallbackMeta.director,
        language: csvMeta.language ?? fallbackMeta.language,
        originalTitle: csvMeta.originalTitle ?? fallbackMeta.originalTitle,
      }
    : fallbackMeta;

  if (curated) {
    return {
      ...baseMeta,
      ...curated,
      cast: curated.cast?.length ? curated.cast : baseMeta.cast,
      director: curated.director ?? baseMeta.director,
      language: curated.language ?? baseMeta.language,
      originalTitle: curated.originalTitle ?? baseMeta.originalTitle,
      keywords: curated.keywords?.length ? curated.keywords : baseMeta.keywords,
      rating: curated.rating ?? baseMeta.rating,
      runtime: curated.runtime ?? baseMeta.runtime,
    };
  }

  return baseMeta;
}

// ─── Hints & Attributes ───────────────────────────────────────────────────────

export function buildGuessHints(guess: CatalogMovie, target: CatalogMovie): GuessHints {
  const gm = getMovieMeta(guess);
  const tm = getMovieMeta(target);

  const relation: YearRelation =
    target.year === guess.year ? "same" : target.year > guess.year ? "later" : "earlier";

  const hints: GuessHints = {
    year: {
      value: guess.year,
      relation,
      decadeMatch: Math.floor(guess.year / 10) === Math.floor(target.year / 10),
      within5: Math.abs(guess.year - target.year) <= 5,
    },
    cast: [],
    genres: guess.genres.filter((g) => target.genres.some((t) => t.toLowerCase() === g.toLowerCase())),
  };

  if (gm.director && tm.director && normPerson(gm.director) === normPerson(tm.director)) {
    hints.director = tm.director;
  }

  const targetCast = new Set(tm.cast.map(normPerson));
  hints.cast = gm.cast.filter((c) => targetCast.has(normPerson(c)));

  if (gm.language && tm.language && gm.language.toLowerCase() === tm.language.toLowerCase()) {
    hints.language = tm.language;
  }

  return hints;
}

export function evaluateAttributeGuess(
  kind: AttributeKind,
  rawValue: string,
  target: CatalogMovie
): AttributeCheckResult {
  const value = rawValue.trim();
  const tm = getMovieMeta(target);

  if (kind === "director") {
    const isMatch = Boolean(tm.director && normPerson(tm.director) === normPerson(value));
    return {
      kind,
      value: isMatch && tm.director ? tm.director : value,
      matched: isMatch,
      message: isMatch
        ? `Confirmed! Directed by ${tm.director}.`
        : `Not directed by ${value}.`,
      hintsPatch: isMatch && tm.director ? { director: tm.director } : {},
    };
  }

  if (kind === "actor") {
    const matchedCast = tm.cast.find((c) => normPerson(c) === normPerson(value));
    const isMatch = Boolean(matchedCast);
    return {
      kind,
      value: matchedCast ?? value,
      matched: isMatch,
      message: isMatch
        ? `Confirmed! ${matchedCast} is in the cast.`
        : `${value} is not in today's cast list.`,
      hintsPatch: matchedCast ? { actor: matchedCast } : {},
    };
  }

  if (kind === "year") {
    const yr = parseInt(value, 10);
    const validYear = !isNaN(yr) ? yr : 2000;
    const relation: YearRelation =
      target.year === validYear ? "same" : target.year > validYear ? "later" : "earlier";
    const decadeMatch = Math.floor(validYear / 10) === Math.floor(target.year / 10);
    const within5 = Math.abs(validYear - target.year) <= 5;
    const msg =
      relation === "same"
        ? `Exact match! Released in ${validYear}.`
        : relation === "later"
          ? `Today's movie was released AFTER ${validYear} (▲).`
          : `Today's movie was released BEFORE ${validYear} (▼).`;

    return {
      kind,
      value: String(validYear),
      matched: relation === "same",
      message: msg,
      hintsPatch: {
        year: {
          value: validYear,
          relation,
          decadeMatch,
          within5,
        },
      },
    };
  }

  if (kind === "genre") {
    const matchedGenre = target.genres.find((g) => g.toLowerCase() === value.toLowerCase());
    const isMatch = Boolean(matchedGenre);
    return {
      kind,
      value: matchedGenre ?? value,
      matched: isMatch,
      message: isMatch
        ? `Confirmed! Genre includes ${matchedGenre}.`
        : `${value} is not listed as a genre for today's film.`,
      hintsPatch: matchedGenre ? { genre: matchedGenre } : {},
    };
  }

  // language
  const isLangMatch = Boolean(tm.language && tm.language.toLowerCase() === value.toLowerCase());
  return {
    kind: "language",
    value: isLangMatch && tm.language ? tm.language : value,
    matched: isLangMatch,
    message: isLangMatch
      ? `Confirmed! Original language is ${tm.language}.`
      : `Today's film is not in ${value}.`,
    hintsPatch: isLangMatch && tm.language ? { language: tm.language } : {},
  };
}

// ─── Multi-Aspect Calibrated Match Score Engine ──────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "his", "her", "their",
  "they", "them", "who", "whom", "whose", "what", "which", "when", "where",
  "why", "how", "are", "was", "were", "been", "being", "have", "has", "had",
  "having", "does", "did", "doing", "will", "would", "shall", "should", "can",
  "could", "may", "might", "must", "into", "onto", "upon", "over", "under",
  "after", "before", "between", "through", "during", "without", "within",
  "against", "among", "around", "about", "across", "behind", "beyond", "near",
  "off", "out", "down", "only", "own", "same", "than", "too", "very", "just",
  "now", "then", "more", "most", "other", "some", "such", "not", "nor", "but",
  "also", "both", "each", "few", "many", "much", "all", "any", "every", "one",
  "two", "three", "first", "new", "old", "young", "man", "woman", "men", "women",
  "life", "world", "find", "finds", "make", "makes", "take", "takes", "come",
  "comes", "becomes", "become", "must", "set", "sets", "story", "film", "movie",
  "years", "year", "time", "way", "day", "days", "back", "get", "gets", "help",
]);

function stemToken(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ion") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("al") && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  return w;
}

function extractContentTokens(text: string): Set<string> {
  const out = new Set<string>();
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/);
  for (const raw of words) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const stemmed = stemToken(raw);
    if (stemmed.length >= 3 && !STOPWORDS.has(stemmed)) {
      out.add(stemmed);
    }
  }
  return out;
}

const THEME_CLUSTERS: Record<string, string[]> = {
  epic_royalty_empire: [
    "empire", "emperor", "king", "queen", "kingdom", "throne", "prince", "princess",
    "dynasty", "royal", "crown", "palace", "ancient", "rome", "roman", "reign",
    "heir", "succession", "monarch", "sultan", "mahishmati", "ruler", "sovereign",
  ],
  warrior_arena_vengeance: [
    "gladiator", "arena", "colosseum", "warrior", "sword", "battle", "battlefield",
    "army", "general", "soldier", "war", "rebellion", "rebel", "slavery", "slave",
    "vengeance", "revenge", "betrayal", "betray", "honor", "honour", "conquer",
    "combat", "duel", "shield", "chariot", "legion", "exile", "avenge",
  ],
  crime_mafia_underworld: [
    "crime", "criminal", "mafia", "mob", "gangster", "don", "patriarch", "syndicate",
    "cartel", "heist", "robbery", "hitman", "assassin", "assassination", "drug",
    "corrupt", "underworld", "omerta", "boss", "extortion", "smuggler", "gang",
  ],
  justice_prison_investigation: [
    "detective", "police", "cop", "investigator", "murder", "killer", "serial",
    "trial", "court", "lawyer", "judge", "prison", "inmate", "warden", "jail",
    "escape", "shawshank", "innocent", "sentence", "convict", "forensic", "alibi",
  ],
  superhero_vigilante_chaos: [
    "batman", "joker", "gotham", "superhero", "vigilante", "hero", "villain",
    "cape", "comic", "arkham", "dark knight", "chaos", "mask", "superpower",
    "mutant", "avenger", "justice league", "menace", "wayne",
  ],
  scifi_space_cosmos: [
    "space", "planet", "galaxy", "star", "interstellar", "wormhole", "astronaut",
    "spacecraft", "spaceship", "alien", "cosmos", "orbit", "nasa", "colony",
    "jedi", "force", "lightsaber", "rebel alliance", "apocalypse", "extinction",
  ],
  mind_dream_simulation: [
    "dream", "subconscious", "inception", "matrix", "simulation", "virtual",
    "reality", "mind", "memory", "illusion", "hacker", "cyber", "machine",
    "artificial", "time travel", "paradox", "corporate", "espionage", "architect",
  ],
  psychological_underground_identity: [
    "insomnia", "underground", "soap", "fight club", "split", "personality",
    "nihilism", "anarchy", "consumer", "mental", "delusion", "psychosis",
    "trauma", "obsession", "alter ego", "cult", "twist",
  ],
  creature_monster_survival: [
    "shark", "jaws", "beach", "island", "ocean", "sea", "boat", "dinosaur",
    "jurassic", "park", "clone", "predator", "creature", "monster", "beast",
    "terror", "survive", "survival", "prey", "expedition", "jungle",
  ],
  fantasy_spirit_myth: [
    "spirit", "witch", "bathhouse", "curse", "dragon", "magic", "spell",
    "gods", "myth", "mythology", "reincarnation", "rebirth", "past life",
    "immortal", "supernatural", "enchanted", "sorcerer", "demon", "housefly",
  ],
  animation_family_coming_of_age: [
    "toy", "cowboy", "spaceman", "woody", "buzz", "child", "kid", "cub",
    "lion", "pride", "savanna", "simba", "animated", "cartoon", "pixar",
    "disney", "ghibli", "puppet", "playroom", "childhood", "growing up",
  ],
  romance_passion_voyage: [
    "love", "romance", "romantic", "lover", "heart", "wedding", "marriage",
    "bride", "groom", "affair", "titanic", "iceberg", "ship", "voyage",
    "ocean liner", "passion", "soulmate", "heartbreak", "relationship",
  ],
  social_comedy_youth: [
    "high school", "teen", "teenager", "popular", "makeover", "matchmaker",
    "beverly hills", "campus", "college", "prom", "friendship", "party",
    "hilarious", "satire", "clueless", "comedy", "humor", "humour", "awkward",
  ],
  historical_odyssey_biopic: [
    "history", "historical", "decades", "president", "vietnam", "ping pong",
    "feather", "biography", "true story", "medal", "destiny", "miracle",
    "chronicle", "generation", "legacy", "era",
  ],
};

function getMovieThemeVector(movie: CatalogMovie): Map<string, number> {
  const meta = getMovieMeta(movie);
  const fullText = [
    movie.title,
    meta.originalTitle ?? "",
    movie.genres.join(" "),
    (meta.keywords ?? []).join(" "),
    movie.plot,
  ]
    .join(" ")
    .toLowerCase();

  const tokens = extractContentTokens(fullText);
  const scores = new Map<string, number>();

  for (const [cluster, terms] of Object.entries(THEME_CLUSTERS)) {
    let hits = 0;
    for (const term of terms) {
      if (term.includes(" ")) {
        if (fullText.includes(term)) hits += 2;
      } else if (tokens.has(stemToken(term)) || fullText.includes(term)) {
        hits += 1;
      }
    }
    if (hits > 0) {
      scores.set(cluster, Math.min(1, hits / 3));
    }
  }
  return scores;
}

function computeThemeClusterSimilarity(a: CatalogMovie, b: CatalogMovie): number {
  const vecA = getMovieThemeVector(a);
  const vecB = getMovieThemeVector(b);
  if (vecA.size === 0 || vecB.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  const allKeys = new Set([...vecA.keys(), ...vecB.keys()]);
  for (const k of allKeys) {
    const va = vecA.get(k) ?? 0;
    const vb = vecB.get(k) ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

const GENRE_AFFINITY: Record<string, Record<string, number>> = {
  action: { adventure: 0.7, thriller: 0.55, "sci-fi": 0.5, "science fiction": 0.5, crime: 0.45, war: 0.65, history: 0.45, fantasy: 0.5 },
  adventure: { action: 0.7, fantasy: 0.65, "sci-fi": 0.55, "science fiction": 0.55, family: 0.5, animation: 0.45, history: 0.45 },
  drama: { history: 0.6, romance: 0.5, crime: 0.55, biography: 0.65, war: 0.55, thriller: 0.4, mystery: 0.4 },
  crime: { thriller: 0.7, mystery: 0.6, drama: 0.55, action: 0.45 },
  thriller: { crime: 0.7, mystery: 0.7, action: 0.55, horror: 0.5, "sci-fi": 0.4, drama: 0.4 },
  "sci-fi": { "science fiction": 1.0, fantasy: 0.55, action: 0.5, adventure: 0.55, thriller: 0.4, mystery: 0.4 },
  "science fiction": { "sci-fi": 1.0, fantasy: 0.55, action: 0.5, adventure: 0.55, thriller: 0.4 },
  fantasy: { adventure: 0.65, "sci-fi": 0.55, animation: 0.55, family: 0.55, action: 0.5 },
  animation: { family: 0.8, fantasy: 0.55, adventure: 0.5, comedy: 0.5 },
  family: { animation: 0.8, comedy: 0.55, adventure: 0.5, fantasy: 0.55 },
  comedy: { romance: 0.55, family: 0.55, animation: 0.5, drama: 0.3 },
  romance: { comedy: 0.55, drama: 0.5 },
  history: { war: 0.75, drama: 0.6, biography: 0.7, action: 0.45, adventure: 0.45 },
  war: { history: 0.75, action: 0.65, drama: 0.55 },
};

function computeGenreSimilarity(gGenres: string[], tGenres: string[]): number {
  if (gGenres.length === 0 || tGenres.length === 0) return 0;
  const gNorm = gGenres.map((g) => g.toLowerCase().trim());
  const tNorm = tGenres.map((g) => g.toLowerCase().trim());

  const exactJaccard = jaccard(gNorm, tNorm);

  let sumBest = 0;
  for (const g of gNorm) {
    let best = 0;
    for (const t of tNorm) {
      if (g === t) {
        best = 1.0;
        break;
      }
      const aff = GENRE_AFFINITY[g]?.[t] ?? GENRE_AFFINITY[t]?.[g] ?? 0;
      if (aff > best) best = aff;
    }
    sumBest += best;
  }
  const softOverlap = sumBest / gNorm.length;
  const primaryMatch = gNorm[0] === tNorm[0] ? 0.15 : (GENRE_AFFINITY[gNorm[0]]?.[tNorm[0]] ?? 0) * 0.08;

  return clamp01(0.55 * exactJaccard + 0.45 * softOverlap + primaryMatch);
}

function extractSeriesStem(title: string): string {
  const base = normalizeTitle(title);
  const beforeColon = normalizeTitle(title.split(/[:\-–]/)[0] || title);
  const strippedSeq = beforeColon
    .replace(/\b(part|episode|vol|volume|chapter|book)\s*([0-9]+|i|ii|iii|iv|v|vi|vii|viii|ix|x)\b.*$/i, "")
    .replace(/\s+([0-9]+|ii|iii|iv|v)\s*$/i, "")
    .trim();
  return strippedSeq || base;
}

function computeFranchiseSimilarity(guess: CatalogMovie, target: CatalogMovie): number {
  const gNorm = normalizeTitle(guess.title);
  const tNorm = normalizeTitle(target.title);
  if (gNorm === tNorm) return 1.0;

  const gStem = extractSeriesStem(guess.title);
  const tStem = extractSeriesStem(target.title);
  if (gStem.length >= 3 && gStem === tStem) return 1.0;

  const gAliases = guess.aliases.map(normalizeTitle);
  const tAliases = target.aliases.map(normalizeTitle);
  if (gAliases.includes(tNorm) || tAliases.includes(gNorm) || gAliases.includes(tStem) || tAliases.includes(gStem)) {
    return 0.85;
  }

  return 0;
}

export function computeMatchPercent(
  guess: CatalogMovie,
  target: CatalogMovie,
  cosine: number
): number {
  if (guess.id === target.id) return 100;

  const hints = buildGuessHints(guess, target);
  const gm = getMovieMeta(guess);
  const tm = getMovieMeta(target);

  const franchiseSim = computeFranchiseSimilarity(guess, target);

  const gTokens = extractContentTokens(
    `${guess.title} ${(gm.keywords ?? []).join(" ")} ${guess.plot}`
  );
  const tTokens = extractContentTokens(
    `${target.title} ${(tm.keywords ?? []).join(" ")} ${target.plot}`
  );
  let sharedTokens = 0;
  for (const tok of gTokens) {
    if (tTokens.has(tok)) sharedTokens++;
  }
  const diceTokens =
    gTokens.size + tTokens.size > 0
      ? (2 * sharedTokens) / (gTokens.size + tTokens.size)
      : 0;
  const lexicalSim = clamp01(diceTokens / 0.28);

  const keywordSim =
    gm.keywords?.length && tm.keywords?.length
      ? clamp01(jaccard(gm.keywords, tm.keywords) / 0.25)
      : 0;

  const clusterSim = computeThemeClusterSimilarity(guess, target);
  const thematicSim = clamp01(
    0.50 * clusterSim + 0.35 * lexicalSim + 0.15 * keywordSim
  );

  const isNeural = (id: string) => !id.startsWith("csv-") && !id.startsWith("cat-");
  const bothNeural = isNeural(guess.id) && isNeural(target.id);
  const bothHash =
    (guess.id.startsWith("csv-") || guess.id.startsWith("cat-")) &&
    (target.id.startsWith("csv-") || target.id.startsWith("cat-"));

  let semanticScore: number;
  if (bothNeural) {
    const neuralNorm = clamp01((cosine - 0.12) / 0.60);
    semanticScore = Math.max(neuralNorm, 0.58 * neuralNorm + 0.42 * thematicSim);
  } else if (bothHash) {
    const hashNorm = clamp01((cosine - 0.08) / 0.45);
    semanticScore = Math.max(thematicSim, 0.65 * thematicSim + 0.35 * hashNorm);
  } else {
    semanticScore = clamp01(thematicSim * 1.12);
  }

  const genreScore = computeGenreSimilarity(guess.genres, target.genres);

  const yearDiff = Math.abs(guess.year - target.year);
  const yearDecay = Math.exp(-yearDiff / 22);
  const decadeBonus = hints.year.decadeMatch ? 0.12 : 0;
  const closeYearBonus = yearDiff === 0 ? 0.15 : hints.year.within5 ? 0.08 : 0;
  const eraScore = clamp01(yearDecay + decadeBonus + closeYearBonus);

  const langScore = hints.language ? 1.0 : 0.25;
  const runtimeScore =
    gm.runtime && tm.runtime
      ? Math.exp(-Math.abs(gm.runtime - tm.runtime) / 45)
      : 0.5;
  const ratingScore =
    gm.rating && tm.rating
      ? Math.exp(-Math.abs(gm.rating - tm.rating) / 1.5)
      : 0.6;
  const profileScore = 0.50 * langScore + 0.30 * runtimeScore + 0.20 * ratingScore;

  const directorBonus = hints.director ? 0.14 : 0;
  const castBonus =
    hints.cast.length >= 3
      ? 0.15
      : hints.cast.length === 2
        ? 0.11
        : hints.cast.length === 1
          ? 0.07
          : 0;
  const franchiseBonus = franchiseSim * 0.22;

  const rawScore =
    0.46 * semanticScore +
    0.26 * genreScore +
    0.16 * eraScore +
    0.12 * profileScore +
    directorBonus +
    castBonus +
    franchiseBonus;

  const pct = Math.round(clamp01(rawScore) * 100);
  return Math.max(1, Math.min(99, pct));
}

// ─── Reveals & Clues ──────────────────────────────────────────────────────────

export function buildRevealedAnswer(movie: CatalogMovie): RevealedAnswer {
  const m = getMovieMeta(movie);
  return {
    title: movie.title,
    year: movie.year,
    ...(m.director ? { director: m.director } : {}),
    ...(m.cast.length ? { cast: m.cast } : {}),
    ...(movie.genres?.length ? { genres: movie.genres } : {}),
    ...(m.language ? { language: m.language } : {}),
    ...(m.runtime ? { runtime: m.runtime } : {}),
  };
}

function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(" ");
}

export function maskPlot(plot: string, movie: CatalogMovie): string {
  const words = new Set<string>();
  const meta = getMovieMeta(movie);
  for (const source of [movie.title, meta.originalTitle ?? "", ...movie.aliases]) {
    for (const w of source.split(/[^A-Za-z0-9\u00C0-\u024F]+/)) {
      if (w.length >= 4 && !/^(the|part|episode|with|from|that|this|beginning|conclusion)$/i.test(w)) words.add(w);
    }
  }
  let out = plot;
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "gi"), "▇▇▇");
  }
  return out.replace(new RegExp(`\\b${movie.year}\\b`, "g"), "▇▇▇▇");
}

export function buildClues(movie: CatalogMovie): Omit<Clue, "n" | "total">[] {
  const meta = getMovieMeta(movie);
  const clues: Omit<Clue, "n" | "total">[] = [];

  if (movie.genres?.length) {
    clues.push({ label: "Genre", text: movie.genres.join(" · ") });
  }

  const decade = Math.floor(movie.year / 10) * 10;
  clues.push({ label: "Era", text: `Released in the ${decade}s` });

  const langBits = [
    meta.language ? `Language: ${meta.language}` : "",
    meta.runtime ? `Runtime: ${meta.runtime} min` : "",
  ].filter(Boolean);
  if (langBits.length) clues.push({ label: "Details", text: langBits.join(" · ") });

  if (meta.director) {
    clues.push({ label: "Director", text: `Directed by someone with the initials ${initials(meta.director)}` });
  }

  if (meta.cast[0]) {
    clues.push({ label: "Cast", text: `Starring an actor whose first name is ${meta.cast[0].split(" ")[0]}` });
  }

  if (movie.plot) {
    const masked = maskPlot(movie.plot, movie);
    const excerpt = masked.length > 180 ? `${masked.slice(0, 180).replace(/\s+\S*$/, "")}…` : masked;
    clues.push({ label: "Plot", text: excerpt });
  }

  clues.push({ label: "Release year", text: `Released in the year ${movie.year}` });

  return clues;
}

// ─── Search Functions ─────────────────────────────────────────────────────────

export function searchCatalog(query: string, movies: CatalogMovie[], limit = 40): SearchSuggestion[] {
  const rawQ = normalizeForSearch(query);
  if (rawQ.length === 0) return [];

  const strippedQ = normalizeTitle(query);
  const spellRawQ = normalizeSpelling(rawQ);
  const spellStrippedQ = normalizeSpelling(strippedQ);

  const ranked: Array<{ rank: number; isPrimary: number; movie: CatalogMovie; meta: ReturnType<typeof getMovieMeta> }> = [];

  for (const movie of movies) {
    const rawTitle = normalizeForSearch(movie.title);
    const strippedTitle = normalizeTitle(movie.title);
    const meta = getMovieMeta(movie);

    const aliasList = [
      ...(meta.originalTitle && meta.originalTitle !== movie.title ? [meta.originalTitle] : []),
      ...movie.aliases,
    ];
    const rawAliases = aliasList.map(normalizeForSearch).filter(Boolean);
    const strippedAliases = aliasList.map(normalizeTitle).filter(Boolean);

    let rank = -1;

    if (rawQ.length === 1) {
      if (rawTitle.startsWith(rawQ)) {
        rank = 0;
      } else if (rawAliases.some((a) => a.startsWith(rawQ))) {
        rank = 1;
      } else if (strippedTitle.startsWith(rawQ)) {
        rank = 2;
      }
    } else {
      const spellRawTitle = normalizeSpelling(rawTitle);
      const spellStrippedTitle = normalizeSpelling(strippedTitle);

      if (rawTitle === rawQ || strippedTitle === rawQ || `${rawTitle} ${movie.year}` === rawQ) {
        rank = 0;
      } else if (rawTitle.startsWith(rawQ) || spellRawTitle.startsWith(spellRawQ)) {
        rank = 1;
      } else if (
        strippedQ.length >= 2 &&
        (strippedTitle.startsWith(strippedQ) || spellStrippedTitle.startsWith(spellStrippedQ))
      ) {
        rank = 2;
      } else if (
        rawAliases.some((a) => a.startsWith(rawQ) || normalizeSpelling(a).startsWith(spellRawQ)) ||
        (strippedQ.length >= 2 &&
          strippedAliases.some((a) => a.startsWith(strippedQ) || normalizeSpelling(a).startsWith(spellStrippedQ)))
      ) {
        rank = 3;
      } else {
        const words = rawTitle.split(" ");
        if (words.some((w, i) => i > 0 && words.slice(i).join(" ").startsWith(rawQ))) {
          rank = 4;
        } else if (
          rawQ.length >= 3 &&
          (rawTitle.includes(rawQ) ||
            spellRawTitle.includes(spellRawQ) ||
            rawAliases.some((a) => a.includes(rawQ) || normalizeSpelling(a).includes(spellRawQ)))
        ) {
          rank = 5;
        }
      }
    }

    if (rank >= 0) {
      const isPrimary = movie.id.startsWith("cat-") || movie.id.startsWith("csv-") ? 1 : 0;
      ranked.push({ rank, isPrimary, movie, meta });
    }
  }

  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.isPrimary - b.isPrimary ||
        a.movie.title.localeCompare(b.movie.title) ||
        a.movie.year - b.movie.year
    )
    .slice(0, limit)
    .map(({ movie, meta }) => ({
      title: movie.title,
      year: movie.year,
      label: `${movie.title} (${movie.year})`,
      ...(meta.originalTitle && meta.originalTitle !== movie.title ? { originalTitle: meta.originalTitle } : {}),
      ...(meta.director ? { director: meta.director } : {}),
      ...(meta.language ? { language: meta.language } : {}),
    }));
}

export function searchAttributes(
  query: string,
  movies: CatalogMovie[],
  limit = 8
): AttributeSuggestion[] {
  const q = normalizeForSearch(query);
  if (q.length < 2) return [];

  const out: Array<{ rank: number; item: AttributeSuggestion }> = [];
  const seen = new Set<string>();

  const push = (rank: number, kind: AttributeKind, value: string, prefixLabel: string) => {
    const key = `${kind}::${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      rank,
      item: {
        kind,
        value,
        label: `${prefixLabel}: ${value}`,
      },
    });
  };

  if (/^\d{2,4}$/.test(q)) {
    const years = new Set<number>();
    for (const m of movies) {
      if (String(m.year).startsWith(q)) years.add(m.year);
    }
    for (const yr of [...years].sort((a, b) => b - a).slice(0, 4)) {
      push(yr.toString() === q ? 0 : 1, "year", String(yr), "Year");
    }
  }

  for (const movie of movies) {
    const meta = getMovieMeta(movie);

    if (meta.director) {
      const normD = normalizeForSearch(meta.director);
      const wordsD = normD.split(" ");
      if (normD.startsWith(q)) {
        push(0, "director", meta.director, "Director");
      } else if (wordsD.some((w) => w.startsWith(q))) {
        push(1, "director", meta.director, "Director");
      }
    }

    for (const actor of meta.cast) {
      const normA = normalizeForSearch(actor);
      const wordsA = normA.split(" ");
      if (normA.startsWith(q)) {
        push(1, "actor", actor, "Actor");
      } else if (wordsA.some((w) => w.startsWith(q))) {
        push(2, "actor", actor, "Actor");
      }
    }

    for (const genre of movie.genres) {
      const normG = normalizeForSearch(genre);
      if (normG.startsWith(q)) {
        push(0, "genre", genre, "Genre");
      }
    }

    if (meta.language) {
      const normL = normalizeForSearch(meta.language);
      if (normL.startsWith(q)) {
        push(0, "language", meta.language, "Language");
      }
    }
  }

  return out
    .sort((a, b) => a.rank - b.rank || a.item.value.localeCompare(b.item.value))
    .slice(0, limit)
    .map((x) => x.item);
}

// ─── Candidate Movie Resolution ───────────────────────────────────────────────

export function resolveCandidateMovie(
  rawGuess: string,
  movies: CatalogMovie[],
  options: { strict?: boolean } = {}
): CatalogMovie | null {
  const trimmed = rawGuess.trim();
  if (!trimmed) return null;

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

  const pickBest = (matches: CatalogMovie[]): CatalogMovie => {
    if (extractedYear) {
      const exactYear = matches.find((m) => m.year === extractedYear);
      if (exactYear) return exactYear;
    }
    return matches[0];
  };

  // Stage 1: Exact normalized title match
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

  // Stage 3: Common spelling variations
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
    let lowestDistance = 3;

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
