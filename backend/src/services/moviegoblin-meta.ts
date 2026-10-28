/**
 * Movie metadata sidecar (director, cast, language, runtime).
 *
 * Checks the generated curated metadata first (`src/data/movie-meta.ts`) and falls back to
 * the full 6,153-movie combined CSV dataset (`wordgoblin_movies_combined.csv`).
 */
import { normalizeTitle, normalizeSpelling } from "./moviegoblin.js";
import { MOVIE_META } from "../data/movie-meta.js";
import { loadCombinedCsvDataset } from "./moviegoblin-csv.js";

export type MovieMeta = {
  director?: string;
  cast: string[];
  language?: string;
  runtime?: number;
  originalTitle?: string;
  keywords?: string[];
  rating?: number;
  poster_url?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
};

export function metaKey(title: string, year: number): string {
  return `${normalizeTitle(title)}::${year}`;
}

export function foldedMetaKey(title: string, year: number): string {
  return `${normalizeSpelling(normalizeTitle(title))}::${year}`;
}

const foldedMovieMeta = new Map<string, MovieMeta>();
for (const [k, v] of Object.entries(MOVIE_META)) {
  const [t, y] = k.split("::");
  if (t && y) {
    const fk = `${normalizeSpelling(t)}::${y}`;
    if (!foldedMovieMeta.has(fk) || (v.director && !foldedMovieMeta.get(fk)?.director)) {
      foldedMovieMeta.set(fk, v);
    }
  }
}

const EMPTY_META: MovieMeta = { cast: [] };

export function getMovieMeta(movie: { title: string; year: number }): MovieMeta {
  const key = metaKey(movie.title, movie.year);
  const fKey = foldedMetaKey(movie.title, movie.year);
  const curated = MOVIE_META[key] ?? foldedMovieMeta.get(fKey);
  const csvMetaMap = loadCombinedCsvDataset().metaByKey;
  const csvMeta = csvMetaMap[key] ?? (fKey ? Object.entries(csvMetaMap).find(([k]) => {
    const [t, y] = k.split("::");
    return y === String(movie.year) && normalizeSpelling(t) === normalizeSpelling(normalizeTitle(movie.title));
  })?.[1] : undefined);

  if (curated && csvMeta) {
    return {
      ...csvMeta,
      ...curated,
      poster_url: curated.poster_url || csvMeta.poster_url,
      keywords: curated.keywords?.length ? curated.keywords : csvMeta.keywords,
      rating: curated.rating ?? csvMeta.rating,
      popularity: curated.popularity ?? csvMeta.popularity,
      vote_count: curated.vote_count ?? csvMeta.vote_count,
      vote_average: curated.vote_average ?? csvMeta.vote_average,
    };
  }
  return curated ?? csvMeta ?? EMPTY_META;
}
