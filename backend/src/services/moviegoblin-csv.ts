/**
 * Loads the combined movie datasets (wordgoblin_movies_combined.csv + 9000plus.csv)
 * into memory so autocomplete, title/alias resolution, and credit lookups work across
 * the entire ~13,000+ film catalog without modifying Supabase tables.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTitle, type CatalogMovie } from "./moviegoblin.js";
import type { MovieMeta } from "./moviegoblin-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function sanitize9000Csv(text: string): string {
  // Fix unquoted multiline Pixie Hollow Bake Off row by properly enclosing the overview in quotes
  return text.replace(
    /(2013-10-20,Pixie Hollow Bake Off,)(Tink challenges[\s\S]*? - Magic Tricks,)/,
    (_match, p1, p2) => {
      const cleanOverview = p2.slice(0, -1).replace(/\r?\n\s*/g, " ");
      return `${p1}"${cleanOverview}",`;
    }
  );
}

export function parseCSV(text: string): string[][] {
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

export function languageName(code: string): string | undefined {
  const clean = code.trim().toLowerCase();
  if (!clean) return undefined;
  if (LANG_NAMES[clean]) return LANG_NAMES[clean];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(clean) ?? undefined;
  } catch {
    return undefined;
  }
}

export function buildAliasesForRow(title: string, originalTitle?: string, year?: number): string[] {
  const aliases = new Set<string>();
  const normTitle = normalizeTitle(title);

  if (originalTitle && originalTitle.trim() && originalTitle.trim() !== title.trim()) {
    aliases.add(originalTitle.trim());
  }

  if (title.includes(":") || title.includes(" - ")) {
    const prefix = title.split(/[:\-]/)[0].trim();
    if (prefix && prefix.length >= 2 && normalizeTitle(prefix) !== normTitle) {
      aliases.add(prefix);
      if (year) aliases.add(`${prefix} (${year})`);
    }
  }

  if (/part\s+(ii|iii|iv|2|3|4)/i.test(title)) {
    const num = title.match(/part\s+(ii|iii|iv|2|3|4)/i)?.[1]?.toLowerCase();
    const cleanPrefix = title.split(/[:\-]/)[0].trim();
    const arab = num === "ii" ? "2" : num === "iii" ? "3" : num === "iv" ? "4" : num;
    aliases.add(`${cleanPrefix} ${arab}`);
    aliases.add(`${cleanPrefix} Part ${arab}`);
  }

  if (/aa|ee|oo/i.test(title)) {
    const variant = title
      .replace(/aa/gi, "a")
      .replace(/ee/gi, "i")
      .replace(/oo/gi, "u");
    if (variant !== title) {
      aliases.add(variant);
      if (variant.includes(":") || variant.includes(" - ")) {
        const vPrefix = variant.split(/[:\-]/)[0].trim();
        if (vPrefix.length >= 2) aliases.add(vPrefix);
      }
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of aliases) {
    const t = a.trim();
    const n = normalizeTitle(t);
    if (!n || n === normTitle || seen.has(n)) continue;
    seen.add(n);
    out.push(t);
  }
  return out;
}

/**
 * Generates a deterministic 384-d unit vector from movie text features so CSV-only
 * movies can participate in cosineSimilarity when not yet embedded in Supabase.
 */
export function textToVector384(text: string): number[] {
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

export type LoadedDataset = {
  movies: CatalogMovie[];
  metaByKey: Record<string, MovieMeta>;
};

let cachedDataset: LoadedDataset | null = null;

function findCombinedCsvPath(): string | null {
  const candidates = [
    resolve(__dirname, "..", "..", "..", "wordgoblin_movies_combined.csv"),
    resolve(process.cwd(), "wordgoblin_movies_combined.csv"),
    resolve(process.cwd(), "..", "wordgoblin_movies_combined.csv"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function find9000CsvPath(): string | null {
  const candidates = [
    resolve(__dirname, "..", "..", "..", "9000plus.csv"),
    resolve(process.cwd(), "9000plus.csv"),
    resolve(process.cwd(), "..", "9000plus.csv"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadCombinedCsvDataset(): LoadedDataset {
  if (cachedDataset) return cachedDataset;

  const combinedCsvPath = findCombinedCsvPath();
  const csv9000Path = find9000CsvPath();

  if (!combinedCsvPath && !csv9000Path) {
    cachedDataset = { movies: [], metaByKey: {} };
    return cachedDataset;
  }

  // Pre-load 9000plus.csv into a lookup map to enrich existing records and prepare new ones
  type NewCsvEntry = {
    r: number;
    title: string;
    year: number;
    overview: string;
    genres: string[];
    lang?: string;
    poster?: string;
    popularity?: number;
    voteCount?: number;
    voteAvg?: number;
  };
  const entries9000ByKey = new Map<string, NewCsvEntry>();

  if (csv9000Path && existsSync(csv9000Path)) {
    const raw9000 = readFileSync(csv9000Path, "utf-8").replace(/^\ufeff/, "");
    const sanitized9000 = sanitize9000Csv(raw9000);
    const rows9000 = parseCSV(sanitized9000);
    if (rows9000.length > 1) {
      const header = rows9000[0].map((h) => h.trim());
      const iDate = header.indexOf("Release_Date");
      const iTitle = header.indexOf("Title");
      const iOverview = header.indexOf("Overview");
      const iPop = header.indexOf("Popularity");
      const iVotes = header.indexOf("Vote_Count");
      const iVoteAvg = header.indexOf("Vote_Average");
      const iLang = header.indexOf("Original_Language");
      const iGenre = header.indexOf("Genre");
      const iPoster = header.indexOf("Poster_Url");

      for (let r = 1; r < rows9000.length; r++) {
        const row = rows9000[r];
        const title = (row[iTitle] || "").trim();
        const dateStr = (row[iDate] || "").trim();
        const overview = (row[iOverview] || "").trim();
        if (!title || !overview || overview.length <= 10) continue;

        const yearMatch = dateStr.match(/^(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
        if (year < 1888 || year > 2100) continue;

        const norm = normalizeTitle(title);
        if (!norm) continue;
        const key = `${norm}::${year}`;

        const rawGenres = (row[iGenre] || "").trim();
        const genres = rawGenres
          ? rawGenres
              .split(/[|,]/)
              .map((g) => g.trim())
              .filter(Boolean)
          : ["Drama"];
        const lang = languageName(row[iLang] || "");
        const poster = (row[iPoster] || "").trim();
        const popVal = parseFloat(row[iPop] || "");
        const popularity = !isNaN(popVal) && popVal > 0 ? popVal : undefined;
        const votesVal = parseInt(row[iVotes] || "", 10);
        const voteCount = !isNaN(votesVal) && votesVal >= 0 ? votesVal : undefined;
        const avgVal = parseFloat(row[iVoteAvg] || "");
        const voteAvg = !isNaN(avgVal) && avgVal > 0 ? avgVal : undefined;

        // Keep highest popularity in case of intra-file duplicates
        const existing = entries9000ByKey.get(key);
        if (!existing || (popularity ?? 0) > (existing.popularity ?? 0)) {
          entries9000ByKey.set(key, {
            r,
            title,
            year,
            overview,
            genres,
            lang,
            poster: poster || undefined,
            popularity,
            voteCount,
            voteAvg,
          });
        }
      }
    }
  }

  const movies: CatalogMovie[] = [];
  const metaByKey: Record<string, MovieMeta> = {};
  const seenKey = new Set<string>();
  const seenNorm = new Map<string, number>();

  // 1. Process primary wordgoblin_movies_combined.csv (taking precedence for director, cast, runtime)
  if (combinedCsvPath && existsSync(combinedCsvPath)) {
    const raw = readFileSync(combinedCsvPath, "utf-8").replace(/^\ufeff/, "");
    const rows = parseCSV(raw);

    if (rows.length > 1) {
      const header = rows[0].map((h) => h.trim());
      const idx = (name: string) => header.indexOf(name);

      const iTitle = idx("title");
      const iOrig = idx("original_title");
      const iYear = idx("year");
      const iLang = idx("language");
      const iGenres = idx("genres");
      const iKeywords = idx("keywords");
      const iOverview = idx("overview");
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
        if (seenKey.has(dedupKey)) continue;
        seenKey.add(dedupKey);

        const origTitle = (cols[iOrig] || "").trim();
        const rawGenres = (cols[iGenres] || "").trim();
        const genres = rawGenres
          ? rawGenres
              .split(/[|,]/)
              .map((g) => g.trim())
              .filter(Boolean)
          : ["Drama"];

        const plot = (cols[iOverview] || "").trim() || `${title} (${year}) — ${genres.join(", ")} film.`;
        const keywordsRaw = (cols[iKeywords] || "").trim();
        const keywords = keywordsRaw
          ? keywordsRaw
              .split(/[|,]/)
              .map((k) => k.trim())
              .filter(Boolean)
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

        // Enrich with poster and vote metrics from 9000plus.csv if available
        const enrichment = entries9000ByKey.get(dedupKey);
        const posterUrl = enrichment?.poster;
        const popularity = enrichment?.popularity;
        const voteCount = enrichment?.voteCount;
        const voteAvg = enrichment?.voteAvg ?? rating;

        let finalNorm = baseNorm;
        const extraAliases: string[] = [];
        if (seenNorm.has(baseNorm) && seenNorm.get(baseNorm) !== year) {
          finalNorm = `${baseNorm} ${year}`;
          extraAliases.push(baseNorm, `${title} (${year})`, `${title} ${year}`);
        } else {
          seenNorm.set(baseNorm, year);
        }

        const aliases = [
          ...buildAliasesForRow(title, origTitle, year),
          ...extraAliases,
        ];

        metaByKey[dedupKey] = {
          ...(director ? { director } : {}),
          cast,
          ...(lang ? { language: lang } : {}),
          ...(runtime ? { runtime } : {}),
          ...(rating ? { rating } : {}),
          ...(keywords.length ? { keywords } : {}),
          ...(origTitle && origTitle !== title ? { originalTitle: origTitle } : {}),
          ...(posterUrl ? { poster_url: posterUrl } : {}),
          ...(popularity ? { popularity } : {}),
          ...(voteCount ? { vote_count: voteCount } : {}),
          ...(voteAvg ? { vote_average: voteAvg } : {}),
        };

        movies.push({
          id: `csv-${r}`,
          title,
          normalized_title: finalNorm,
          aliases,
          year,
          genres,
          plot,
          embedding: textToVector384(
            `${title} ${origTitle} ${year} ${genres.join(" ")} ${keywordsRaw} ${plot} ${director ?? ""} ${cast.join(" ")}`
          ),
          is_active: true,
          poster_url: posterUrl,
          popularity,
          vote_count: voteCount,
          vote_average: voteAvg,
        });
      }
    }
  }

  // 2. Process new non-overlapping records from 9000plus.csv
  for (const [key, entry] of entries9000ByKey.entries()) {
    if (seenKey.has(key)) continue;
    seenKey.add(key);

    const baseNorm = normalizeTitle(entry.title);
    let finalNorm = baseNorm;
    const extraAliases: string[] = [];

    // Remake handling: append year to normalized_title to satisfy uniqueness
    if (seenNorm.has(baseNorm) && seenNorm.get(baseNorm) !== entry.year) {
      finalNorm = `${baseNorm} ${entry.year}`;
      extraAliases.push(baseNorm, `${entry.title} (${entry.year})`, `${entry.title} ${entry.year}`);
    } else {
      seenNorm.set(baseNorm, entry.year);
    }

    const aliases = [
      ...buildAliasesForRow(entry.title, undefined, entry.year),
      ...extraAliases,
    ];

    metaByKey[key] = {
      cast: [],
      ...(entry.lang ? { language: entry.lang } : {}),
      ...(entry.poster ? { poster_url: entry.poster } : {}),
      ...(entry.popularity ? { popularity: entry.popularity } : {}),
      ...(entry.voteCount ? { vote_count: entry.voteCount } : {}),
      ...(entry.voteAvg ? { vote_average: entry.voteAvg, rating: entry.voteAvg } : {}),
    };

    movies.push({
      id: `csv-9000-${entry.r}`,
      title: entry.title,
      normalized_title: finalNorm,
      aliases,
      year: entry.year,
      genres: entry.genres,
      plot: entry.overview,
      embedding: textToVector384(
        `${entry.title} ${entry.year} ${entry.genres.join(" ")} ${entry.overview}`
      ),
      is_active: true,
      poster_url: entry.poster,
      popularity: entry.popularity,
      vote_count: entry.voteCount,
      vote_average: entry.voteAvg,
    });
  }

  cachedDataset = { movies, metaByKey };
  return cachedDataset;
}
