import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { pipeline, env } from "@huggingface/transformers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Disable local model lookups; use cached or HF CDN assets
env.allowLocalModels = false;

// ─── Schemas & Types ──────────────────────────────────────────────────────────

const RawMovieSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty"),
  aliases: z.array(z.string().trim().min(1)).default([]),
  year: z.number().int().min(1888).max(2100),
  genres: z.array(z.string().trim().min(1)).min(1, "At least one genre is required"),
  plot: z.string().trim().min(20, "Plot summary must be at least 20 characters"),
  clues: z.array(z.string().trim().min(1)).optional().default([]),
});

export type RawMovie = z.infer<typeof RawMovieSchema>;

export type PreparedMovie = {
  title: string;
  normalized_title: string;
  aliases: string[];
  year: number;
  genres: string[];
  plot: string;
  clues: string[];
  embedding: number[];
  is_active: boolean;
};

// ─── Normalization Utilities ──────────────────────────────────────────────────

/**
 * Normalizes title for consistent deduplication and fast indexing:
 * - Converts to lower case
 * - Strips leading articles ("the", "a", "an")
 * - Removes non-alphanumeric characters
 * - Collapses repeated whitespace
 */
export function normalizeTitle(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cleans and deduplicates aliases.
 */
export function normalizeAliases(aliases: string[], canonicalNormalized: string): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const alias of aliases) {
    const trimmed = alias.trim();
    const normalized = normalizeTitle(trimmed);
    if (!normalized || normalized === canonicalNormalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    cleaned.push(trimmed);
  }

  return cleaned;
}

/**
 * Calculates the Euclidean L2 norm of a vector.
 */
function calculateL2Norm(vec: number[]): number {
  let sum = 0;
  for (const val of vec) {
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Builds the composite string used for dense semantic embedding.
 */
export function buildEmbeddingInput(movie: RawMovie): string {
  return `${movie.title}. Released in ${movie.year}. Genres: ${movie.genres.join(", ")}. Plot summary: ${movie.plot}`;
}

// ─── Main Ingestion / Preparation Pipeline ────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDryRun = !isApply || args.includes("--dry-run");

  console.log("==================================================================");
  console.log(" MovieGoblin: Movie Ingestion & Seed Preparation Pipeline");
  console.log(` Mode: ${isDryRun ? "DRY-RUN (Validation & Embedding only)" : "APPLY (Database Upsert)"}`);
  console.log("==================================================================");

  // 1. Read curated seed dataset
  const dataPath = resolve(__dirname, "data", "curated-movies.json");
  console.log(`[1/4] Reading dataset from: ${dataPath}`);
  const rawContent = await readFile(dataPath, "utf-8");
  const rawJson = JSON.parse(rawContent);

  if (!Array.isArray(rawJson)) {
    throw new Error("Dataset root must be an array of movie objects.");
  }

  console.log(`      Found ${rawJson.length} raw movie records.`);

  // 2. Validate records & deduplicate in-memory
  console.log("[2/4] Validating records and normalizing titles...");
  const validatedMovies: RawMovie[] = [];
  const normalizedSeen = new Map<string, string>();

  for (let i = 0; i < rawJson.length; i++) {
    const parsed = RawMovieSchema.safeParse(rawJson[i]);
    if (!parsed.success) {
      throw new Error(`Validation failed for record index ${i}: ${parsed.error.message}`);
    }

    const norm = normalizeTitle(parsed.data.title);
    if (!norm) {
      throw new Error(`Movie at index ${i} ('${parsed.data.title}') produces an empty normalized title.`);
    }

    if (normalizedSeen.has(norm)) {
      throw new Error(
        `Duplicate movie detected: '${parsed.data.title}' and '${normalizedSeen.get(norm)}' both normalize to '${norm}'.`
      );
    }

    normalizedSeen.set(norm, parsed.data.title);
    validatedMovies.push(parsed.data);
  }
  console.log(`      Validated ${validatedMovies.length} unique movie records.`);

  // 3. Initialize Transformer Feature Extractor
  console.log("[3/4] Initializing Xenova/all-MiniLM-L6-v2 pipeline...");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
  });
  console.log("      Model loaded successfully.");

  // 4. Generate & validate embeddings
  console.log("[4/4] Generating 384-dimensional normalized embeddings...");
  const preparedRecords: PreparedMovie[] = [];

  for (let i = 0; i < validatedMovies.length; i++) {
    const movie = validatedMovies[i];
    const textInput = buildEmbeddingInput(movie);
    const normTitle = normalizeTitle(movie.title);
    const cleanedAliases = normalizeAliases(movie.aliases, normTitle);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (extractor as any)(textInput, {
      pooling: "mean",
      normalize: true,
    });

    const embedding = Array.from(output.data as Float32Array);

    // Verification assertions
    if (embedding.length !== 384) {
      throw new Error(
        `Invalid embedding dimension for '${movie.title}': expected 384, received ${embedding.length}`
      );
    }

    const hasInvalidNumbers = embedding.some((val) => Number.isNaN(val) || !Number.isFinite(val));
    if (hasInvalidNumbers) {
      throw new Error(`Embedding for '${movie.title}' contains NaN or infinite values.`);
    }

    const l2Norm = calculateL2Norm(embedding);
    if (Math.abs(l2Norm - 1.0) > 0.02) {
      throw new Error(
        `Embedding for '${movie.title}' is not properly normalized. L2 norm: ${l2Norm.toFixed(4)}`
      );
    }

    preparedRecords.push({
      title: movie.title,
      normalized_title: normTitle,
      aliases: cleanedAliases,
      year: movie.year,
      genres: movie.genres,
      plot: movie.plot,
      clues: movie.clues ?? [],
      embedding,
      is_active: true,
    });

    console.log(
      `      [${i + 1}/${validatedMovies.length}] Embedded '${movie.title}' (${movie.year}) - norm: ${l2Norm.toFixed(4)}`
    );
  }

  // 5. Save prepared output fixture locally
  const outputPath = resolve(__dirname, "data", "curated-movies-prepared.json");
  await writeFile(outputPath, JSON.stringify(preparedRecords, null, 2), "utf-8");
  console.log(`\n Prepared fixture saved locally to: ${outputPath}`);

  // 6. Database Upsert (Only if explicitly running in apply mode)
  if (isDryRun) {
    console.log("\n==================================================================");
    console.log(" DRY RUN COMPLETE: All records validated and successfully embedded.");
    console.log(" No remote database changes were made.");
    console.log(" To apply to Supabase when ready, run with: --apply");
    console.log("==================================================================");
    return;
  }

  // When --apply is specified:
  console.log("\nConnecting to Supabase to upsert records...");
  const { supabaseAdmin } = await import("../src/services/supabase.js");

  const { data, error } = await supabaseAdmin
    .from("moviegoblin_movies")
    .upsert(preparedRecords, {
      onConflict: "normalized_title",
      ignoreDuplicates: false,
    })
    .select("id, title, normalized_title");

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message} (code: ${error.code})`);
  }

  console.log(`Successfully upserted ${data?.length ?? 0} movie records into 'moviegoblin_movies'.`);
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed with error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
