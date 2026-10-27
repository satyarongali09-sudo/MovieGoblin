/**
 * Movie metadata sidecar (director, cast, language, runtime).
 *
 * Checks the generated curated metadata first (`src/data/movie-meta.ts`) and falls back to
 * the full 6,153-movie combined CSV dataset (`wordgoblin_movies_combined.csv`).
 */
import { normalizeTitle } from "./moviegoblin.js";
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

const EMPTY_META: MovieMeta = { cast: [] };

export function getMovieMeta(movie: { title: string; year: number }): MovieMeta {
  const key = metaKey(movie.title, movie.year);
  const curated = MOVIE_META[key];
  const csvMeta = loadCombinedCsvDataset().metaByKey[key];
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
