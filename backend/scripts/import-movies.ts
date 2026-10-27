import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import { pipeline, env } from "@huggingface/transformers";
import { normalizeTitle, normalizeSpelling } from "../src/services/moviegoblin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

env.allowLocalModels = false;

// ─── CSV Parser Helper ────────────────────────────────────────────────────────

export function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// ─── Alias Generation ─────────────────────────────────────────────────────────

export function generateMovieAliases(
  title: string,
  originalTitle?: string,
  year?: number,
  existingAliases: string[] = []
): string[] {
  const aliases = new Set<string>();
  const normTitle = normalizeTitle(title);

  // Preserve existing explicit aliases
  for (const a of existingAliases) {
    if (a && a.trim()) aliases.add(a.trim());
  }

  // Original title if different
  if (originalTitle && originalTitle.trim() && originalTitle.trim() !== title.trim()) {
    aliases.add(originalTitle.trim());
  }

  // Subtitle / franchise handling (e.g. "Baahubali: The Beginning" -> "Baahubali")
  if (title.includes(":") || title.includes(" - ")) {
    const prefix = title.split(/[:\-]/)[0].trim();
    if (prefix && normalizeTitle(prefix) !== normTitle) {
      aliases.add(prefix);
      if (year) aliases.add(`${prefix} (${year})`);
    }
  }

  // Roman numeral sequel handling (e.g. "The Godfather: Part II" -> "Godfather 2", "The Godfather 2")
  if (/part\s+(ii|iii|iv|2|3|4)/i.test(title)) {
    const num = title.match(/part\s+(ii|iii|iv|2|3|4)/i)?.[1]?.toLowerCase();
    const cleanPrefix = title.split(/[:\-]/)[0].trim();
    const arab = num === "ii" ? "2" : num === "iii" ? "3" : num === "iv" ? "4" : num;
    aliases.add(`${cleanPrefix} ${arab}`);
    aliases.add(`${cleanPrefix} Part ${arab}`);
  }

  // Transliteration spelling variations (e.g. "Baahubali" -> "Bahubali")
  if (/aa|ee|oo/i.test(title)) {
    const variant = title
      .replace(/aa/gi, "a")
      .replace(/ee/gi, "i")
      .replace(/oo/gi, "u");
    if (variant !== title) {
      aliases.add(variant);
      if (variant.includes(":") || variant.includes(" - ")) {
        const vPrefix = variant.split(/[:\-]/)[0].trim();
        aliases.add(vPrefix);
      }
    }
  }

  // Clean and filter aliases: remove alias if it exactly matches canonical title
  const finalAliases: string[] = [];
  const seenNorm = new Set<string>();

  for (const alias of aliases) {
    const trimmed = alias.trim();
    const norm = normalizeTitle(trimmed);
    if (!norm || norm === normTitle || seenNorm.has(norm)) {
      continue;
    }
    seenNorm.add(norm);
    finalAliases.push(trimmed);
  }

  return finalAliases;
}

// ─── Embedding input builder ──────────────────────────────────────────────────

function buildEmbeddingInput(movie: {
  title: string;
  year: number;
  genres: string[];
  plot: string;
}): string {
  return `${movie.title}. Released in ${movie.year}. Genres: ${movie.genres.join(", ")}. Plot summary: ${movie.plot}`;
}

function calculateL2Norm(vec: number[]): number {
  let sum = 0;
  for (const val of vec) sum += val * val;
  return Math.sqrt(sum);
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

export async function runMovieImport(options: { apply?: boolean; csvPath?: string } = {}) {
  const isApply =
    options.apply ??
    process.argv.includes("--apply") ??
    process.argv.some((a) => a.includes("apply")) ??
    process.env.APPLY === "true";
  const isDryRun = !isApply || process.argv.includes("--dry-run");

  console.log("==================================================================");
  console.log(" MovieGoblin: Safe Repeatable Movie Import & Enrichment Pipeline");
  console.log(` Mode: ${isDryRun ? "DRY-RUN (Validation & Fixture Preparation)" : "APPLY (Supabase Upsert)"}`);
  console.log("==================================================================");

  // 1. Load curated base movies
  const curatedJsonPath = resolve(__dirname, "data", "curated-movies.json");
  const curatedContent = await readFile(curatedJsonPath, "utf-8");
  const baseCurated = JSON.parse(curatedContent) as Array<{
    title: string;
    aliases?: string[];
    year: number;
    genres: string[];
    plot: string;
    clues?: string[];
  }>;

  console.log(`[1/5] Loaded ${baseCurated.length} base curated movies.`);

  // 2. Read candidates from CSV
  const csvFilePath = options.csvPath || resolve(__dirname, "..", "..", "wordgoblin_movies_combined.csv");
  console.log(`[2/5] Scanning CSV from: ${csvFilePath}`);

  const candidatesToEnrich: Array<{
    title: string;
    original_title?: string;
    year: number;
    genres: string[];
    plot: string;
    aliases: string[];
    poster_url?: string;
  }> = [];

  // High-priority titles to import from CSV
  const priorityPatterns = [
    /^fight club$/i,
    /^baahubali/i,
    /^the godfather/i,
    /^inception$/i,
    /^batman$/i,
    /^adavi ramudu$/i,
    /^interstellar$/i,
    /^the dark knight$/i,
    /^the matrix$/i,
    /^titanic$/i,
    /^spirited away$/i,
    /^am[eé]lie$/i,
    /^eega$/i,
    /^magadheera$/i,
    /^rrr$/i,
  ];

  if (createReadStream(csvFilePath)) {
    const fileStream = createReadStream(csvFilePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let header: string[] | null = null;

    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!header) {
        header = parseCSVLine(line).map((h) => h.replace(/^\ufeff/, "").trim());
        continue;
      }

      const cols = parseCSVLine(line);
      const row: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) {
        row[header[i]] = cols[i] || "";
      }

      const title = (row.title || "").trim();
      const origTitle = (row.original_title || "").trim();
      const overview = (row.overview || "").trim();
      const year = parseInt(row.year, 10);

      if (!title || !overview || overview.length <= 10 || isNaN(year) || year < 1888 || year > 2100) {
        continue;
      }

      // Check if priority title matches
      const isPriority = priorityPatterns.some((pattern) => pattern.test(title) || pattern.test(origTitle));

      if (isPriority) {
        const rawGenres = row.genres || "Drama";
        const genres = rawGenres
          .split(/[,|]/)
          .map((g) => g.trim())
          .filter(Boolean);

        const poster = (row.poster_url || row.Poster_Url || "").trim() || undefined;

        candidatesToEnrich.push({
          title,
          original_title: origTitle,
          year,
          genres: genres.length > 0 ? genres : ["Drama"],
          plot: overview,
          aliases: generateMovieAliases(title, origTitle, year),
          poster_url: poster,
        });
      }
    }
  }

  console.log(`      Extracted ${candidatesToEnrich.length} priority films from CSV.`);

  // 3. Deduplicate without merging remakes or different films with the same title
  console.log("[3/5] Merging and disambiguating duplicate titles / remakes...");
  const combinedRaw: Array<{
    title: string;
    normalized_title: string;
    aliases: string[];
    year: number;
    genres: string[];
    plot: string;
    clues: string[];
    poster_url?: string;
  }> = [];

  const seenByTitleYear = new Set<string>();
  const seenNormalizedTitles = new Map<string, number>(); // norm -> year of first seen

  // First, add existing base curated movies
  for (const m of baseCurated) {
    const key = `${normalizeTitle(m.title)}::${m.year}`;
    if (!seenByTitleYear.has(key)) {
      seenByTitleYear.add(key);
      const norm = normalizeTitle(m.title);
      seenNormalizedTitles.set(norm, m.year);

      combinedRaw.push({
        title: m.title,
        normalized_title: norm,
        aliases: generateMovieAliases(m.title, undefined, m.year, m.aliases || []),
        year: m.year,
        genres: m.genres,
        plot: m.plot,
        clues: m.clues || [],
      });
    }
  }

  // Next, add candidates from CSV
  for (const m of candidatesToEnrich) {
    const key = `${normalizeTitle(m.title)}::${m.year}`;
    if (seenByTitleYear.has(key)) {
      continue; // Skip exact duplicate (title + year)
    }
    seenByTitleYear.add(key);

    const baseNorm = normalizeTitle(m.title);
    let finalNorm = baseNorm;
    const aliases = [...m.aliases];

    // If normalized_title already exists for a different year (e.g. Batman 1966 vs Batman 1989):
    if (seenNormalizedTitles.has(baseNorm)) {
      const existingYear = seenNormalizedTitles.get(baseNorm)!;
      if (existingYear !== m.year) {
        // Disambiguate remake by appending year to normalized_title to satisfy DB unique index
        finalNorm = `${baseNorm} ${m.year}`;
        aliases.push(baseNorm);
        aliases.push(`${m.title} (${m.year})`);
        aliases.push(`${m.title} ${m.year}`);
      }
    } else {
      seenNormalizedTitles.set(baseNorm, m.year);
    }

    combinedRaw.push({
      title: m.title,
      normalized_title: finalNorm,
      aliases: generateMovieAliases(m.title, m.original_title, m.year, aliases),
      year: m.year,
      genres: m.genres,
      plot: m.plot,
      clues: [],
      poster_url: m.poster_url,
    });
  }

  console.log(`      Total consolidated movie records: ${combinedRaw.length}.`);

  // 4. Generate & normalize embeddings with Xenova/all-MiniLM-L6-v2
  console.log("[4/5] Initializing Xenova/all-MiniLM-L6-v2 feature extractor...");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
  });

  console.log("      Generating 384-dimensional normalized embeddings...");
  const preparedRecords: Array<{
    title: string;
    normalized_title: string;
    aliases: string[];
    year: number;
    genres: string[];
    plot: string;
    clues: string[];
    embedding: number[];
    is_active: boolean;
    poster_url?: string;
  }> = [];

  for (let i = 0; i < combinedRaw.length; i++) {
    const movie = combinedRaw[i];
    const textInput = buildEmbeddingInput(movie);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (extractor as any)(textInput, {
      pooling: "mean",
      normalize: true,
    });

    const embedding = Array.from(output.data as Float32Array);
    if (embedding.length !== 384) {
      throw new Error(`Invalid embedding dimension for '${movie.title}': expected 384, got ${embedding.length}`);
    }

    const norm = calculateL2Norm(embedding);
    if (Math.abs(norm - 1.0) > 0.05) {
      throw new Error(`Embedding for '${movie.title}' is not normalized. Norm: ${norm}`);
    }

    preparedRecords.push({
      ...movie,
      embedding,
      is_active: true,
      ...(movie.poster_url ? { poster_url: movie.poster_url } : {}),
    });

    if ((i + 1) % 5 === 0 || i + 1 === combinedRaw.length) {
      console.log(`      [${i + 1}/${combinedRaw.length}] Embedded '${movie.title}' (${movie.year})`);
    }
  }

  // Save prepared fixture locally
  const outputPath = resolve(__dirname, "data", "curated-movies-prepared.json");
  await writeFile(outputPath, JSON.stringify(preparedRecords, null, 2), "utf-8");
  console.log(`\n Prepared fixture saved locally to: ${outputPath}`);

  // 5. Database Upsert (if --apply specified)
  if (isDryRun) {
    console.log("\n==================================================================");
    console.log(" DRY RUN COMPLETE: All records validated and successfully embedded.");
    console.log(" No remote database changes were made.");
    console.log(" To apply to Supabase, run with: --apply");
    console.log("==================================================================");
    return { beforeCount: null, afterCount: null, recordsCount: preparedRecords.length };
  }

  console.log("\n[5/5] Connecting to Supabase for safe, batched upsert...");
  const { supabaseAdmin } = await import("../src/services/supabase.js");

  // Query catalog size before fix
  const { count: beforeCount, error: countErr } = await supabaseAdmin
    .from("moviegoblin_movies")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    throw new Error(`Failed to query catalog count before import: ${countErr.message}`);
  }

  console.log(`      Catalog size before import: ${beforeCount ?? 0} active movies.`);

  // Batched upsert to handle any size cleanly
  const BATCH_SIZE = 25;
  for (let i = 0; i < preparedRecords.length; i += BATCH_SIZE) {
    const batch = preparedRecords.slice(i, i + BATCH_SIZE);
    const { error: upsertErr } = await supabaseAdmin
      .from("moviegoblin_movies")
      .upsert(batch, {
        onConflict: "normalized_title",
        ignoreDuplicates: false,
      });

    if (upsertErr) {
      throw new Error(`Supabase batch upsert failed: ${upsertErr.message} (code: ${upsertErr.code})`);
    }
  }

  // Query catalog size after fix
  const { count: afterCount, error: afterErr } = await supabaseAdmin
    .from("moviegoblin_movies")
    .select("*", { count: "exact", head: true });

  if (afterErr) {
    throw new Error(`Failed to query catalog count after import: ${afterErr.message}`);
  }

  console.log(`\n==================================================================`);
  console.log(` IMPORT COMPLETE!`);
  console.log(` Catalog size before: ${beforeCount ?? 0} movies`);
  console.log(` Catalog size after:  ${afterCount ?? 0} movies (+${(afterCount ?? 0) - (beforeCount ?? 0)} new movies)`);
  console.log(`==================================================================`);

  return { beforeCount, afterCount, recordsCount: preparedRecords.length };
}

// Direct CLI execution
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMovieImport().catch((err) => {
    console.error("\n❌ Import pipeline failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
