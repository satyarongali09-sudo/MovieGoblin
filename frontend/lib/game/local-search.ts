import catalogIndex from "./catalog-index.json";
import type { AttributeKind, AttributeSuggestion, SearchCatalogResponse, SearchSuggestion } from "./client";

type CompactMovie = {
  t: string;
  y: number;
  o?: string;
  d?: string;
  l?: string;
  p?: number;
  pu?: string;
};

const MOVIES = (catalogIndex.movies ?? []) as CompactMovie[];
const DIRECTORS = (catalogIndex.directors ?? []) as string[];
const ACTORS = (catalogIndex.actors ?? []) as string[];
const GENRES = (catalogIndex.genres ?? []) as string[];
const LANGUAGES = (catalogIndex.languages ?? []) as string[];

export function normalizeKeepArticles(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStripArticles(input: string): string {
  return normalizeKeepArticles(input).replace(/^(a|an|the)\s+/i, "").trim();
}

function normalizeSpelling(input: string): string {
  return input
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u");
}

function buildRowAliases(m: CompactMovie): string[] {
  const out: string[] = [];
  if (m.o && m.o !== m.t) out.push(m.o);
  if (m.t.includes(":") || m.t.includes(" - ")) {
    const prefix = m.t.split(/[:\-]/)[0].trim();
    if (prefix.length >= 2) out.push(prefix);
  }
  return out;
}

/**
 * Instant client-side search across all 6,154 combined movies + attributes (Director, Actor, Year, Genre, Language).
 */
export function searchLocalCatalog(query: string, movieLimit = 40, attrLimit = 8): SearchCatalogResponse {
  const rawQ = normalizeKeepArticles(query);
  if (rawQ.length === 0) return { results: [], attributes: [] };

  const strippedQ = normalizeStripArticles(query);
  const spellRawQ = normalizeSpelling(rawQ);
  const spellStrippedQ = normalizeSpelling(strippedQ);

  const rankedMovies: Array<{ rank: number; isPrimary: number; m: CompactMovie }> = [];

  for (let i = 0; i < MOVIES.length; i++) {
    const m = MOVIES[i];
    const rawTitle = normalizeKeepArticles(m.t);
    const strippedTitle = normalizeStripArticles(m.t);
    const aliases = buildRowAliases(m);
    const rawAliases = aliases.map(normalizeKeepArticles).filter(Boolean);
    const strippedAliases = aliases.map(normalizeStripArticles).filter(Boolean);

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

      if (rawTitle === rawQ || strippedTitle === rawQ || `${rawTitle} ${m.y}` === rawQ) {
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
        if (words.some((_w, idx) => idx > 0 && words.slice(idx).join(" ").startsWith(rawQ))) {
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
      rankedMovies.push({ rank, isPrimary: m.p === 1 ? 0 : 1, m });
    }
  }

  const results: SearchSuggestion[] = rankedMovies
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.isPrimary - b.isPrimary ||
        a.m.t.localeCompare(b.m.t) ||
        a.m.y - b.m.y
    )
    .slice(0, movieLimit)
    .map(({ m }) => ({
      title: m.t,
      year: m.y,
      label: `${m.t} (${m.y})`,
      ...(m.o ? { originalTitle: m.o } : {}),
      ...(m.d ? { director: m.d } : {}),
      ...(m.l ? { language: m.l } : {}),
      ...(m.pu ? { poster_url: m.pu } : {}),
    }));

  // Attribute search (for 2+ characters)
  const attributes: AttributeSuggestion[] = [];
  if (rawQ.length >= 2) {
    const rankedAttrs: Array<{ rank: number; item: AttributeSuggestion }> = [];
    const seen = new Set<string>();
    const push = (rank: number, kind: AttributeKind, value: string, prefix: string) => {
      const k = `${kind}::${value.toLowerCase()}`;
      if (seen.has(k)) return;
      seen.add(k);
      rankedAttrs.push({ rank, item: { kind, value, label: `${prefix}: ${value}` } });
    };

    if (/^\d{2,4}$/.test(rawQ)) {
      const years = new Set<number>();
      for (let i = 0; i < MOVIES.length; i++) {
        if (String(MOVIES[i].y).startsWith(rawQ)) years.add(MOVIES[i].y);
      }
      for (const yr of [...years].sort((a, b) => b - a).slice(0, 4)) {
        push(String(yr) === rawQ ? 0 : 1, "year", String(yr), "Year");
      }
    }

    for (const d of DIRECTORS) {
      const nd = normalizeKeepArticles(d);
      if (nd.startsWith(rawQ)) push(0, "director", d, "Director");
      else if (nd.split(" ").some((w) => w.startsWith(rawQ))) push(1, "director", d, "Director");
    }

    for (const g of GENRES) {
      const ng = normalizeKeepArticles(g);
      if (ng.startsWith(rawQ)) push(0, "genre", g, "Genre");
    }

    for (const l of LANGUAGES) {
      const nl = normalizeKeepArticles(l);
      if (nl.startsWith(rawQ)) push(0, "language", l, "Language");
    }

    for (const a of ACTORS) {
      const na = normalizeKeepArticles(a);
      if (na.startsWith(rawQ)) push(1, "actor", a, "Actor");
      else if (na.split(" ").some((w) => w.startsWith(rawQ))) push(2, "actor", a, "Actor");
    }

    attributes.push(
      ...rankedAttrs
        .sort((a, b) => a.rank - b.rank || a.item.value.localeCompare(b.item.value))
        .slice(0, attrLimit)
        .map((x) => x.item)
    );
  }

  return { results, attributes };
}
