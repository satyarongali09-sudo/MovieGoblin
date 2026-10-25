/**
 * Builds backend/src/data/movie-meta.ts: a local metadata sidecar
 * (director, cast, language, runtime) for MovieGoblin catalog movies.
 *
 * - Reads wordgoblin_movies_combined.csv + the prepared catalog fixture.
 * - Never touches Supabase or the network. Safe and repeatable.
 *
 * Usage: npm run build:meta --workspace backend
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTitle } from "../src/services/moviegoblin.js";
import type { MovieMeta } from "../src/services/moviegoblin-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Full-text CSV parser (handles quoted fields containing commas/newlines). */
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

function languageName(code: string): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? undefined;
  } catch {
    return undefined;
  }
}


async function main() {
  const prepared = JSON.parse(
    await readFile(resolve(__dirname, "data", "curated-movies-prepared.json"), "utf-8")
  ) as Array<{ title: string; year: number }>;
  const wanted = new Set(prepared.map((m) => `${normalizeTitle(m.title)}::${m.year}`));

  const csv = parseCSV(
    (await readFile(resolve(__dirname, "..", "..", "wordgoblin_movies_combined.csv"), "utf-8")).replace(/^\ufeff/, "")
  );
  const header = csv[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);

  const out: Record<string, MovieMeta> = {};
  for (const cols of csv.slice(1)) {
    const title = (cols[idx("title")] || "").trim();
    const year = parseInt(cols[idx("year")], 10);
    const key = `${normalizeTitle(title)}::${year}`;
    if (!wanted.has(key) || out[key]) continue;

    const director = (cols[idx("director")] || "").split("|")[0].trim();
    const cast = (cols[idx("cast")] || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    const runtime = Math.round(parseFloat(cols[idx("runtime")]));
    const original = (cols[idx("original_title")] || "").trim();
    out[key] = {
      ...(director ? { director } : {}),
      cast,
      ...(languageName((cols[idx("language")] || "").trim()) ? { language: languageName((cols[idx("language")] || "").trim()) } : {}),
      ...(runtime > 0 ? { runtime } : {}),
      ...(original && original !== title ? { originalTitle: original } : {}),
    };
  }

  // Manual corrections: titles missing from the CSV or with incomplete credits. Overrides win.
  const OVERRIDES: Record<string, MovieMeta> = {
    "star wars episode iv a new hope::1977": {
      director: "George Lucas",
      cast: ["Mark Hamill", "Harrison Ford", "Carrie Fisher", "Alec Guinness", "Peter Cushing"],
      language: "English",
      runtime: 121,
    },
    "adavi ramudu::1977": {
      director: "K. Raghavendra Rao",
      cast: ["N. T. Rama Rao", "Jayaprada", "Jayasudha", "Satyanarayana"],
      language: "Telugu",
      runtime: 159,
    },
    "adavi ramudu::2004": {
      director: "B. Gopal",
      cast: ["Prabhas", "Aarthi Agarwal", "Kota Srinivasa Rao", "Brahmanandam"],
      language: "Telugu",
    },
    "baahubali 2 the conclusion::2017": {
      director: "S. S. Rajamouli",
      cast: ["Prabhas", "Rana Daggubati", "Anushka Shetty", "Tamannaah Bhatia", "Ramya Krishnan"],
      language: "Telugu",
      runtime: 167,
    },
    "baahubali the beginning::2015": {
      director: "S. S. Rajamouli",
      cast: ["Prabhas", "Rana Daggubati", "Anushka Shetty", "Tamannaah Bhatia", "Ramya Krishnan"],
      language: "Telugu",
      runtime: 159,
    },
    "eega::2012": {
      director: "S. S. Rajamouli",
      cast: ["Nani", "Samantha Ruth Prabhu", "Sudeep"],
      language: "Telugu",
      runtime: 145,
    },
    "magadheera::2009": {
      director: "S. S. Rajamouli",
      cast: ["Ram Charan", "Kajal Aggarwal", "Dev Gill", "Srihari"],
      language: "Telugu",
      runtime: 166,
    },
    "matrix::1999": {
      director: "The Wachowskis",
      cast: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss", "Hugo Weaving"],
      language: "English",
      runtime: 136,
    },
  };
  for (const [k, v] of Object.entries(OVERRIDES)) {
    if (wanted.has(k)) out[k] = { ...out[k], ...v };
  }

  const missing = [...wanted].filter((k) => !out[k]);
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  const source =
    `// GENERATED by scripts/build-movie-meta.ts: do not edit by hand.\n` +
    `import type { MovieMeta } from "../services/moviegoblin-meta.js";\n\n` +
    `export const MOVIE_META: Record<string, MovieMeta> = ${JSON.stringify(sorted, null, 2)};\n`;
  await writeFile(resolve(__dirname, "..", "src", "data", "movie-meta.ts"), source, "utf-8");
  console.log(`Wrote metadata for ${Object.keys(out).length}/${wanted.size} catalog movies.`);
  if (missing.length) console.log("No CSV metadata for:", missing.join(", "));

  // Also emit a compact frontend catalog index covering all 6,154 valid movies (curated + CSV)
  const seenFrontendKeys = new Set<string>();
  const frontendMovies: Array<{
    t: string;
    y: number;
    o?: string;
    d?: string;
    l?: string;
    p?: 1;
  }> = [];
  const directorsSet = new Set<string>();
  const actorsSet = new Set<string>();
  const genresSet = new Set<string>();
  const languagesSet = new Set<string>();

  for (const m of prepared as Array<{ title: string; year: number; genres?: string[] }>) {
    const key = `${normalizeTitle(m.title)}::${m.year}`;
    if (seenFrontendKeys.has(key)) continue;
    seenFrontendKeys.add(key);
    const meta = out[key];
    if (meta?.director) directorsSet.add(meta.director);
    meta?.cast?.slice(0, 4).forEach((c) => actorsSet.add(c));
    m.genres?.forEach((g) => genresSet.add(g));
    if (meta?.language) languagesSet.add(meta.language);
    frontendMovies.push({
      t: m.title,
      y: m.year,
      ...(meta?.originalTitle && meta.originalTitle !== m.title ? { o: meta.originalTitle } : {}),
      ...(meta?.director ? { d: meta.director } : {}),
      ...(meta?.language ? { l: meta.language } : {}),
      p: 1,
    });
  }

  for (const cols of csv.slice(1)) {
    const title = (cols[idx("title")] || "").trim();
    const year = parseInt(cols[idx("year")], 10);
    if (!title || isNaN(year) || year < 1888 || year > 2100) continue;
    const norm = normalizeTitle(title);
    if (!norm) continue;
    const key = `${norm}::${year}`;
    if (seenFrontendKeys.has(key)) continue;
    seenFrontendKeys.add(key);

    const override = OVERRIDES[key];
    const director = override?.director || (cols[idx("director")] || "").split("|")[0].trim() || undefined;
    const cast =
      override?.cast ||
      (cols[idx("cast")] || "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
    const lang = override?.language || languageName((cols[idx("language")] || "").trim());
    const orig = (cols[idx("original_title")] || "").trim();
    const genres = (cols[idx("genres")] || "")
      .split(/[|,]/)
      .map((g) => g.trim())
      .filter(Boolean);

    if (director) directorsSet.add(director);
    cast.forEach((c) => actorsSet.add(c));
    genres.forEach((g) => genresSet.add(g));
    if (lang) languagesSet.add(lang);

    frontendMovies.push({
      t: title,
      y: year,
      ...(orig && orig !== title ? { o: orig } : {}),
      ...(director ? { d: director } : {}),
      ...(lang ? { l: lang } : {}),
    });
  }

  const indexPayload = {
    movies: frontendMovies,
    directors: [...directorsSet].sort(),
    actors: [...actorsSet].sort(),
    genres: [...genresSet].sort(),
    languages: [...languagesSet].sort(),
  };

  await writeFile(
    resolve(__dirname, "..", "..", "frontend", "lib", "game", "catalog-index.json"),
    JSON.stringify(indexPayload),
    "utf-8"
  );
  console.log(`Wrote frontend catalog index with ${frontendMovies.length} movies.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
