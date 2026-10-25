/**
 * Loads the full combined movie dataset (wordgoblin_movies_combined.csv, ~6,200 films)
 * into memory so autocomplete, title/alias resolution, and credit lookups work across
 * the entire dataset without modifying Supabase tables.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTitle, type CatalogMovie } from "./moviegoblin.js";
import type { MovieMeta } from "./moviegoblin-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

type LoadedDataset = {
  movies: CatalogMovie[];
  metaByKey: Record<string, MovieMeta>;
};

let cachedDataset: LoadedDataset | null = null;

function findCsvPath(): string | null {
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

export function loadCombinedCsvDataset(): LoadedDataset {
  if (cachedDataset) return cachedDataset;

  const csvPath = findCsvPath();
  if (!csvPath) {
    cachedDataset = { movies: [], metaByKey: {} };
    return cachedDataset;
  }

  const raw = readFileSync(csvPath, "utf-8").replace(/^\ufeff/, "");
  const rows = parseCSV(raw);
  if (rows.length <= 1) {
    cachedDataset = { movies: [], metaByKey: {} };
    return cachedDataset;
  }

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

  const movies: CatalogMovie[] = [];
  const metaByKey: Record<string, MovieMeta> = {};
  const seenKey = new Set<string>();
  const seenNorm = new Map<string, number>();

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const title = (cols[iTitle] || "").trim();
    if (!title) continue;

    const parsedYear = parseInt((cols[iYear] || "").trim(), 10);
    const year = !isNaN(parsedYear) && parsedYear >= 1888 && parsedYear <= 2100 ? parsedYear : 0;
    if (year === 0) continue; // Keep movies with valid release years (6,153 films)

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
    };

    movies.push({
      id: `csv-${r}`,
      title,
      normalized_title: finalNorm,
      aliases,
      year,
      genres,
      plot,
      embedding: textToVector384(`${title} ${origTitle} ${year} ${genres.join(" ")} ${keywordsRaw} ${plot} ${director ?? ""} ${cast.join(" ")}`),
      is_active: true,
    });
  }

  cachedDataset = { movies, metaByKey };
  return cachedDataset;
}
