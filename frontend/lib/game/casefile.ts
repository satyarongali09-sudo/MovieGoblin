import type { GuessResult } from "./daily";
import type { AttributeCheckResult } from "./client";

export type CaseFile = {
  director?: string;
  cast: string[];
  genres: string[];
  language?: string;
  /** Exclusive lower bound: today's film was released AFTER this year. */
  yearAfter?: number;
  /** Exclusive upper bound: today's film was released BEFORE this year. */
  yearBefore?: number;
  /** Set when a guess shared the exact release year. */
  exactYear?: number;
};

/** Aggregates everything the player's guesses and attribute checks have uncovered about today's film. */
export function deriveCaseFile(
  guesses: GuessResult[],
  attributeChecks: AttributeCheckResult[] = []
): CaseFile {
  const file: CaseFile = { cast: [], genres: [] };
  const cast = new Set<string>();
  const genres = new Set<string>();

  for (const g of guesses) {
    const h = g.hints;
    if (!h) continue;

    if (h.director) file.director = h.director;
    if (h.language) file.language = h.language;
    h.cast.forEach((c) => cast.add(c));
    h.genres.forEach((x) => genres.add(x));

    if (h.year.relation === "same") {
      file.exactYear = h.year.value;
    } else if (h.year.relation === "later") {
      file.yearAfter = Math.max(file.yearAfter ?? -Infinity, h.year.value);
    } else {
      file.yearBefore = Math.min(file.yearBefore ?? Infinity, h.year.value);
    }
  }

  for (const chk of attributeChecks) {
    const p = chk.hintsPatch;
    if (!p) continue;
    if (p.director) file.director = p.director;
    if (p.actor) cast.add(p.actor);
    if (p.genre) genres.add(p.genre);
    if (p.language) file.language = p.language;
    if (p.year) {
      if (p.year.relation === "same") {
        file.exactYear = p.year.value;
      } else if (p.year.relation === "later") {
        file.yearAfter = Math.max(file.yearAfter ?? -Infinity, p.year.value);
      } else {
        file.yearBefore = Math.min(file.yearBefore ?? Infinity, p.year.value);
      }
    }
  }

  file.cast = [...cast];
  file.genres = [...genres];
  return file;
}

/** Human-readable release-year window, e.g. "1995-2010", "after 1990", "1999". */
export function describeYearWindow(file: CaseFile): string | null {
  if (file.exactYear !== undefined) return String(file.exactYear);
  const hasAfter = file.yearAfter !== undefined;
  const hasBefore = file.yearBefore !== undefined;
  if (hasAfter && hasBefore) {
    const lo = (file.yearAfter as number) + 1;
    const hi = (file.yearBefore as number) - 1;
    return lo >= hi ? String(lo) : `${lo} to ${hi}`;
  }
  if (hasAfter) return `after ${file.yearAfter}`;
  if (hasBefore) return `before ${file.yearBefore}`;
  return null;
}
