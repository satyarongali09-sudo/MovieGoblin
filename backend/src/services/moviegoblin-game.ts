/**
 * MovieGoblin game logic: calibrated match score, structured guess hints,
 * progressive clues, attribute verification, and catalog search. Pure functions; no I/O.
 */
import { normalizeTitle, normalizeSpelling, type CatalogMovie } from "./moviegoblin.js";
import { getMovieMeta } from "./moviegoblin-meta.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type YearRelation = "same" | "earlier" | "later";

/** Attributes the guessed film SHARES with today's film (plus a release-year direction). */
export type GuessHints = {
  year: {
    value: number;
    /** Where today's film sits relative to the guess: "later" = released after the guess. */
    relation: YearRelation;
    decadeMatch: boolean;
    within5: boolean;
  };
  /** Present only when the guess has the same director as today's film. */
  director?: string;
  /** Cast members shared with today's film. */
  cast: string[];
  /** Genres shared with today's film. */
  genres: string[];
  /** Present only when the language matches. */
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
  poster_url?: string;
};

export type Clue = { n: number; total: number; label: string; text: string };

export type SearchSuggestion = {
  title: string;
  year: number;
  label: string;
  originalTitle?: string;
  director?: string;
  language?: string;
  poster_url?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Normalizes a string for search WITHOUT stripping leading articles ("a", "an", "the").
 * This ensures queries starting with "A", "An", or "The" match titles like "A Beautiful Mind".
 */
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

function normPerson(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map((s) => s.toLowerCase()));
  const B = new Set(b.map((s) => s.toLowerCase()));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ─── Hints ────────────────────────────────────────────────────────────────────

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

// ─── Direct Attribute Verification (Director / Actor / Year / Genre / Language) ─

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

/** Lightweight suffix stemmer so "betrayed"/"betrayal" -> "betray", "warriors" -> "warrior", etc. */
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

/**
 * 16 Cinematic Theme & Narrative Archetype Clusters.
 * Bridges vocabulary differences across synopses (e.g., Gladiator <-> Baahubali / Magadheera / Braveheart).
 */
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

/** Related-genre affinity table so e.g. Action<->Adventure or History<->Drama get partial credit. */
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

  // Best pairwise genre match (exact = 1.0, related = affinity)
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

  // Primary genre match bonus
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
  if (gNorm === tNorm || normalizeSpelling(gNorm) === normalizeSpelling(tNorm)) return 1.0; // Direct remake or transliteration variant

  const gStem = extractSeriesStem(guess.title);
  const tStem = extractSeriesStem(target.title);
  if (
    gStem.length >= 3 &&
    (gStem === tStem || normalizeSpelling(gStem) === normalizeSpelling(tStem))
  ) {
    return 1.0; // Direct sequel (e.g. Godfather vs Godfather Part II, Baahubali 1 vs 2, Bahubali vs Baahubali 2)
  }

  // Check if either movie's aliases reference the other's title/stem (including spelling variations)
  const gAliases = guess.aliases.map(normalizeTitle);
  const tAliases = target.aliases.map(normalizeTitle);
  const gAliasesFold = gAliases.map(normalizeSpelling);
  const tAliasesFold = tAliases.map(normalizeSpelling);
  const gNormFold = normalizeSpelling(gNorm);
  const tNormFold = normalizeSpelling(tNorm);
  const gStemFold = normalizeSpelling(gStem);
  const tStemFold = normalizeSpelling(tStem);

  if (
    gAliases.includes(tNorm) || tAliases.includes(gNorm) ||
    gAliases.includes(tStem) || tAliases.includes(gStem) ||
    gAliasesFold.includes(tNormFold) || tAliasesFold.includes(gNormFold) ||
    gAliasesFold.includes(tStemFold) || tAliasesFold.includes(gStemFold)
  ) {
    return 0.85;
  }

  return 0;
}

/**
 * Computes multi-aspect match percentage (0-99 for wrong films, 100 for exact match).
 * Evaluates 8 distinct cinematic dimensions for every guess and every movie:
 * 1. Semantic / Neural Embedding Similarity (when both have neural vectors)
 * 2. Deep Thematic, Keyword & Plot Archetype Similarity (works across all 6,154 movies)
 * 3. Genre Hierarchy & Related Genre Affinity
 * 4. Era, Release Year & Decade Proximity
 * 5. Director Auteur Match
 * 6. Shared Cast & Lead Star Overlap
 * 7. Language & Runtime Scale Profile
 * 8. Franchise, Sequel & Remake Lineage
 */
export function computeMatchPercent(
  guess: CatalogMovie,
  target: CatalogMovie,
  cosine: number
): number {
  if (
    guess.id === target.id ||
    (guess.year === target.year &&
      (normalizeTitle(guess.title) === normalizeTitle(target.title) ||
        normalizeSpelling(normalizeTitle(guess.title)) === normalizeSpelling(normalizeTitle(target.title)) ||
        target.aliases.map(normalizeTitle).includes(normalizeTitle(guess.title)) ||
        guess.aliases.map(normalizeTitle).includes(normalizeTitle(target.title))))
  ) {
    return 100;
  }

  const hints = buildGuessHints(guess, target);
  const gm = getMovieMeta(guess);
  const tm = getMovieMeta(target);

  // 1. Franchise / Sequel / Remake lineage
  const franchiseSim = computeFranchiseSimilarity(guess, target);

  // 2. Deep Thematic Similarity (Keywords + Stemmed Plot Tokens + 16 Archetype Clusters)
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
  const lexicalSim = clamp01(diceTokens / 0.28); // 28%+ token overlap is near-maximal between distinct synopses

  const keywordSim =
    gm.keywords?.length && tm.keywords?.length
      ? clamp01(jaccard(gm.keywords, tm.keywords) / 0.25)
      : 0;

  const clusterSim = computeThemeClusterSimilarity(guess, target);
  const thematicSim = clamp01(
    0.50 * clusterSim + 0.35 * lexicalSim + 0.15 * keywordSim
  );

  // 3. Semantic Score: blend calibrated neural cosine (when both are neural vectors) with thematicSim
  const bothNeural = !guess.id.startsWith("csv-") && !target.id.startsWith("csv-");
  const bothCsv = guess.id.startsWith("csv-") && target.id.startsWith("csv-");

  let semanticScore: number;
  if (bothNeural) {
    // Neural all-MiniLM-L6-v2 cosine between distinct movies typically spans ~0.10 to ~0.75
    const neuralNorm = clamp01((cosine - 0.12) / 0.60);
    semanticScore = Math.max(neuralNorm, 0.58 * neuralNorm + 0.42 * thematicSim);
  } else if (bothCsv) {
    const hashNorm = clamp01((cosine - 0.08) / 0.45);
    semanticScore = Math.max(thematicSim, 0.65 * thematicSim + 0.35 * hashNorm);
  } else {
    // Cross-catalog comparison (e.g. CSV movie vs Supabase target): use full thematic & cluster engine
    semanticScore = clamp01(thematicSim * 1.12);
  }

  // 4. Genre Similarity (exact Jaccard + soft related-genre affinity + primary genre match)
  const genreScore = computeGenreSimilarity(guess.genres, target.genres);

  // 5. Era & Release Year Proximity
  const yearDiff = Math.abs(guess.year - target.year);
  const yearDecay = Math.exp(-yearDiff / 22);
  const decadeBonus = hints.year.decadeMatch ? 0.12 : 0;
  const closeYearBonus = yearDiff === 0 ? 0.15 : hints.year.within5 ? 0.08 : 0;
  const eraScore = clamp01(yearDecay + decadeBonus + closeYearBonus);

  // 6. Language, Runtime Scale & Rating Profile
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

  // 7. Creative Credits & Lineage Bonuses
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

  // 8. Weighted Synthesis
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

// ─── Reveal ───────────────────────────────────────────────────────────────────

export function buildRevealedAnswer(movie: CatalogMovie): RevealedAnswer {
  const m = getMovieMeta(movie);
  const poster = movie.poster_url || m.poster_url;
  return {
    title: movie.title,
    year: movie.year,
    ...(poster ? { poster_url: poster } : {}),
    ...(m.director ? { director: m.director } : {}),
    ...(m.cast && m.cast.length ? { cast: m.cast } : {}),
    ...(movie.genres?.length ? { genres: movie.genres } : {}),
    ...(m.language ? { language: m.language } : {}),
    ...(m.runtime ? { runtime: m.runtime } : {}),
  };
}

// ─── Clues ────────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(" ");
}

/** Redacts title words (and the release year) from a plot excerpt. */
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

/** Builds the ordered clue ladder (vague to specific) from the data available for the film. */
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

  if (meta.cast && meta.cast[0]) {
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

// ─── Catalog search (Movies + Attributes) ─────────────────────────────────────

/**
 * Autocomplete over the catalog.
 * - Supports 1-character queries (e.g. 'A', 'R', 'B', 'Z') as well as multi-character queries.
 * - Preserves leading articles ("A ...", "An ...", "The ...") while also matching article-stripped titles.
 * - Matches canonical titles, original/regional titles, aliases, and transliterations (e.g. Bahubali <-> Baahubali).
 */
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
      // Single-letter search (e.g. 'A', 'R', 'B', 'Z'): match start of full title or alias
      if (rawTitle.startsWith(rawQ)) {
        rank = 0;
      } else if (rawAliases.some((a) => a.startsWith(rawQ))) {
        rank = 1;
      } else if (strippedTitle.startsWith(rawQ)) {
        rank = 2;
      }
    } else {
      // Multi-character search
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
      const isPrimary = movie.id.startsWith("csv-") ? 1 : 0;
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
      ...(movie.poster_url || meta.poster_url ? { poster_url: movie.poster_url || meta.poster_url } : {}),
    }));
}

/**
 * Searches Directors (D), Actors (★), Release Years (YR), Genres (GN), and Languages (LG)
 * across the catalog so players can also query and select attributes directly.
 */
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

  // 1. Check 4-digit or 2/3-digit year prefix (1920..2026)
  if (/^\d{2,4}$/.test(q)) {
    const years = new Set<number>();
    for (const m of movies) {
      if (String(m.year).startsWith(q)) years.add(m.year);
    }
    for (const yr of [...years].sort((a, b) => b - a).slice(0, 4)) {
      push(yr.toString() === q ? 0 : 1, "year", String(yr), "Year");
    }
  }

  // 2. Scan Directors, Actors, Genres, Languages across catalog
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
