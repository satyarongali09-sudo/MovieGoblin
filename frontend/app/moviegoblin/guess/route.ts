import { NextResponse } from "next/server";
import { z } from "zod";
import {
  movieGoblinService,
  CatalogUnavailableError,
  checkRateLimit,
} from "@/lib/server/moviegoblin-service";

const guessSchema = z.object({
  guess: z
    .string()
    .trim()
    .min(1, "Guess cannot be empty.")
    .max(100, "Guess cannot exceed 100 characters."),
  strict: z.boolean().optional(),
});

const guessHits = new Map();

export async function POST(request: Request) {
  const limit = checkRateLimit(request, guessHits, {
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many guesses submitted. Please wait a moment before trying again.",
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const parsed = guessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid guess payload." },
      { status: 400 }
    );
  }

  try {
    const result = await movieGoblinService.evaluateGuess(parsed.data.guess, undefined, {
      strict: parsed.data.strict,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json(
        { error: "Evaluation unavailable. Catalog is currently unreachable." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
