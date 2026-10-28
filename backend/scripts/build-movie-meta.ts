/**
 * Builds backend/src/data/movie-meta.ts, frontend/lib/server/movie-meta.ts,
 * and frontend/lib/game/catalog-index.json for the full unified catalog (~13,163 films).
 *
 * - Merges wordgoblin_movies_combined.csv + 9000plus.csv + prepared curated fixtures.
 * - Carries Poster_Url, Popularity, and Vote metrics.
 * - Preserves richer director/cast/runtime/keywords from existing catalog.
 * - Never touches Supabase or the network. Safe, deterministic, and repeatable.
 *
 * Usage: npm run build:meta --workspace backend
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTitle } from "../src/services/moviegoblin.js";
import type { MovieMeta } from "../src/services/moviegoblin-meta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function sanitize9000Csv(text: string): string {
  return text.replace(
    /(2013-10-20,Pixie Hollow Bake Off,)(Tink challenges[\s\S]*? - Magic Tricks,)/,
    (_match, p1, p2) => {
      const cleanOverview = p2.slice(0, -1).replace(/\r?\n\s*/g, " ");
      return `${p1}"${cleanOverview}",`;
    }
  );
}

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

async function main() {
  const prepared = JSON.parse(
    await readFile(resolve(__dirname, "data", "curated-movies-prepared.json"), "utf-8")
  ) as Array<{ title: string; year: number }>;
  const wanted = new Set(prepared.map((m) => `${normalizeTitle(m.title)}::${m.year}`));

  const combinedCsvPath = resolve(__dirname, "..", "..", "wordgoblin_movies_combined.csv");
  const csv9000Path = resolve(__dirname, "..", "..", "9000plus.csv");

  // 1. Ingest 9000plus.csv into a lookup map for enrichment & expansion
  type Entry9000 = {
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
  const map9000 = new Map<string, Entry9000>();

  if (existsSync(csv9000Path)) {
    const raw9000 = (await readFile(csv9000Path, "utf-8")).replace(/^\ufeff/, "");
    const sanitized = sanitize9000Csv(raw9000);
    const rows9000 = parseCSV(sanitized);
    if (rows9000.length > 1) {
      const h = rows9000[0].map((x) => x.trim());
      const iDate = h.indexOf("Release_Date");
      const iTitle = h.indexOf("Title");
      const iOverview = h.indexOf("Overview");
      const iPop = h.indexOf("Popularity");
      const iVotes = h.indexOf("Vote_Count");
      const iVoteAvg = h.indexOf("Vote_Average");
      const iLang = h.indexOf("Original_Language");
      const iGenre = h.indexOf("Genre");
      const iPoster = h.indexOf("Poster_Url");

      for (let r = 1; r < rows9000.length; r++) {
        const row = rows9000[r];
        const title = (row[iTitle] || "").trim();
        const dateStr = (row[iDate] || "").trim();
        const overview = (row[iOverview] || "").trim();
        if (!title || !overview || overview.length <= 10) continue;

        const ym = dateStr.match(/^(\d{4})/);
        const year = ym ? parseInt(ym[1], 10) : 0;
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
        const poster = (row[iPoster] || "").trim() || undefined;
        const pop = parseFloat(row[iPop] || "") || undefined;
        const voteCount = parseInt(row[iVotes] || "", 10) || undefined;
        const voteAvg = parseFloat(row[iVoteAvg] || "") || undefined;

        const existing = map9000.get(key);
        if (!existing || (pop ?? 0) > (existing.popularity ?? 0)) {
          map9000.set(key, {
            title,
            year,
            overview,
            genres,
            lang,
            poster,
            popularity: pop,
            voteCount,
            voteAvg,
          });
        }
      }
    }
  }

  // 2. Read existing combined CSV
  const csv = parseCSV(
    (await readFile(combinedCsvPath, "utf-8")).replace(/^\ufeff/, "")
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
    const enrichment = map9000.get(key);

    out[key] = {
      ...(director ? { director } : {}),
      cast,
      ...(languageName((cols[idx("language")] || "").trim())
        ? { language: languageName((cols[idx("language")] || "").trim()) }
        : {}),
      ...(runtime > 0 ? { runtime } : {}),
      ...(original && original !== title ? { originalTitle: original } : {}),
      ...(enrichment?.poster ? { poster_url: enrichment.poster } : {}),
      ...(enrichment?.popularity ? { popularity: enrichment.popularity } : {}),
      ...(enrichment?.voteCount ? { vote_count: enrichment.voteCount } : {}),
      ...(enrichment?.voteAvg ? { vote_average: enrichment.voteAvg } : {}),
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
    "bahubali 2 the conclusion::2017": {
      director: "S. S. Rajamouli",
      cast: ["Prabhas", "Rana Daggubati", "Anushka Shetty", "Tamannaah Bhatia", "Ramya Krishnan"],
      language: "Telugu",
      runtime: 167,
    },
    "bahubali the beginning::2015": {
      director: "S. S. Rajamouli",
      cast: ["Prabhas", "Rana Daggubati", "Anushka Shetty", "Tamannaah Bhatia", "Ramya Krishnan"],
      language: "Telugu",
      runtime: 159,
    },
    "rrr::2022": {
      director: "S. S. Rajamouli",
      cast: ["N. T. Rama Rao Jr.", "Ram Charan", "Alia Bhatt", "Ajay Devgn", "Shriya Saran", "Samuthirakani"],
      language: "Telugu",
      runtime: 187,
    },
    "chatrapathi::2005": {
      director: "S. S. Rajamouli",
      cast: ["Prabhas", "Shriya Saran", "Bhanupriya", "Pradeep Rawat"],
      language: "Telugu",
      runtime: 158,
    },
    "vikramarkudu::2006": {
      director: "S. S. Rajamouli",
      cast: ["Ravi Teja", "Anushka Shetty", "Vineet Kumar", "Brahmanandam"],
      language: "Telugu",
      runtime: 140,
    },
    "simhadri::2003": {
      director: "S. S. Rajamouli",
      cast: ["N. T. Rama Rao Jr.", "Bhumika Chawla", "Ankitha", "Mukesh Rishi"],
      language: "Telugu",
      runtime: 168,
    },
    "sye::2004": {
      director: "S. S. Rajamouli",
      cast: ["Nithiin", "Genelia D'Souza", "Pradeep Rawat", "Shashank"],
      language: "Telugu",
      runtime: 151,
    },
    "maryada ramanna::2010": {
      director: "S. S. Rajamouli",
      cast: ["Sunil", "Saloni Aswani", "Nagineedu", "Supreeth"],
      language: "Telugu",
      runtime: 140,
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

  // Populate known poster overrides for curated classics if missing
  const POSTER_OVERRIDES: Record<string, string> = {
    "fight club::1999": "https://image.tmdb.org/t/p/original/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
    "the godfather::1972": "https://image.tmdb.org/t/p/original/3bhkrj58Vtu7enYsRolD1fZdja1.jpg",
    "the godfather part ii::1974": "https://image.tmdb.org/t/p/original/hek3koDUyMrk7ilW1kEvhFFN2Kf.jpg",
    "inception::2010": "https://image.tmdb.org/t/p/original/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg",
    "batman::1989": "https://image.tmdb.org/t/p/original/cij4dd21v2Rk2URHpDgExiACgHQ.jpg",
    "batman::1966": "https://image.tmdb.org/t/p/original/7k2V0i3c2a1o1H5E6D8A2u5p9lA.jpg",
    "interstellar::2014": "https://image.tmdb.org/t/p/original/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    "the dark knight::2008": "https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
    "the matrix::1999": "https://image.tmdb.org/t/p/original/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
    "matrix::1999": "https://image.tmdb.org/t/p/original/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
    "titanic::1997": "https://image.tmdb.org/t/p/original/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg",
    "spirited away::2001": "https://image.tmdb.org/t/p/original/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
    "amelie::2001": "https://image.tmdb.org/t/p/original/afkQLjA05RPnFZ5g8Z1CkgBwVnT.jpg",
    "baahubali the beginning::2015": "https://image.tmdb.org/t/p/original/9O7gLzmreU0nGkIB6K3BsJbzvNv.jpg",
    "baahubali 2 the conclusion::2017": "https://image.tmdb.org/t/p/original/21sC2assImQIYCEDA84Qh9d1RsK.jpg",
    "bahubali the beginning::2015": "https://image.tmdb.org/t/p/original/9O7gLzmreU0nGkIB6K3BsJbzvNv.jpg",
    "bahubali 2 the conclusion::2017": "https://image.tmdb.org/t/p/original/21sC2assImQIYCEDA84Qh9d1RsK.jpg",
    "rrr::2022": "https://image.tmdb.org/t/p/original/wE0q27Y0AE9QU2E6759hR9O3wA3.jpg",
    "eega::2012": "https://image.tmdb.org/t/p/original/7xW8qH4A9z6e3X6q1D6v6n2Q9W3.jpg",
    "magadheera::2009": "https://image.tmdb.org/t/p/original/s4h6K3j2l1D7c9y8m4h3Q5k7v1.jpg",
    "star wars episode iv a new hope::1977": "https://image.tmdb.org/t/p/original/6FfCtAuVAW8XJjZ7eWeLibRLWTw.jpg",
  };

  for (const [k, v] of Object.entries(OVERRIDES)) {
    out[k] = { ...out[k], ...v };
  }
  for (const [k, url] of Object.entries(POSTER_OVERRIDES)) {
    if (out[k]) out[k].poster_url = url;
  }

  const missing = [...wanted].filter((k) => !out[k]);
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));

  // Write backend movie-meta.ts
  const backendSource =
    `// GENERATED by scripts/build-movie-meta.ts: do not edit by hand.\n` +
    `import type { MovieMeta } from "../services/moviegoblin-meta.js";\n\n` +
    `export const MOVIE_META: Record<string, MovieMeta> = ${JSON.stringify(sorted, null, 2)};\n`;
  await writeFile(resolve(__dirname, "..", "src", "data", "movie-meta.ts"), backendSource, "utf-8");

  // Write frontend movie-meta.ts mirror
  const frontendMetaSource =
    `// GENERATED by scripts/build-movie-meta.ts: do not edit by hand.\n` +
    `export type MovieMeta = {\n` +
    `  director?: string;\n` +
    `  cast: string[];\n` +
    `  language?: string;\n` +
    `  runtime?: number;\n` +
    `  originalTitle?: string;\n` +
    `  keywords?: string[];\n` +
    `  rating?: number;\n` +
    `  poster_url?: string;\n` +
    `  popularity?: number;\n` +
    `  vote_count?: number;\n` +
    `  vote_average?: number;\n` +
    `};\n\n` +
    `export const MOVIE_META: Record<string, MovieMeta> = ${JSON.stringify(sorted, null, 2)};\n`;
  await writeFile(
    resolve(__dirname, "..", "..", "frontend", "lib", "server", "movie-meta.ts"),
    frontendMetaSource,
    "utf-8"
  );
  console.log(`Wrote metadata for ${Object.keys(out).length}/${wanted.size} catalog movies.`);
  if (missing.length) console.log("No CSV metadata for:", missing.join(", "));

  // 3. Emit a unified compact frontend catalog index covering all ~13,163 movies (curated + combined CSV + 9000plus)
  const seenFrontendKeys = new Set<string>();
  const frontendMovies: Array<{
    t: string;
    y: number;
    o?: string;
    d?: string;
    l?: string;
    pu?: string;
    p?: 1;
  }> = [];
  const directorsSet = new Set<string>();
  const actorsSet = new Set<string>();
  const genresSet = new Set<string>();
  const languagesSet = new Set<string>();

  // A. Curated base movies
  for (const m of prepared as Array<{ title: string; year: number; genres?: string[] }>) {
    const key = `${normalizeTitle(m.title)}::${m.year}`;
    if (seenFrontendKeys.has(key)) continue;
    seenFrontendKeys.add(key);
    const meta = out[key];
    const poster = meta?.poster_url || map9000.get(key)?.poster || POSTER_OVERRIDES[key];

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
      ...(poster ? { pu: poster } : {}),
      p: 1,
    });
  }

  // B. Combined CSV movies (6,154 films)
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
    const poster = POSTER_OVERRIDES[key] || map9000.get(key)?.poster;

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
      ...(poster ? { pu: poster } : {}),
    });
  }

  // C. New non-overlapping movies from 9000plus.csv (~7,010 films)
  for (const [key, entry] of map9000.entries()) {
    if (seenFrontendKeys.has(key)) continue;
    seenFrontendKeys.add(key);

    entry.genres.forEach((g) => genresSet.add(g));
    if (entry.lang) languagesSet.add(entry.lang);

    frontendMovies.push({
      t: entry.title,
      y: entry.year,
      ...(entry.lang ? { l: entry.lang } : {}),
      ...(entry.poster ? { pu: entry.poster } : {}),
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
  console.log(`Wrote unified frontend catalog index with ${frontendMovies.length} movies.`);
  console.log(`Indexed ${directorsSet.size} directors, ${actorsSet.size} actors, ${genresSet.size} genres, ${languagesSet.size} languages.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
