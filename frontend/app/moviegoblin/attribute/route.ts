import { NextResponse } from "next/server";
import { z } from "zod";
import {
  movieGoblinService,
  CatalogUnavailableError,
  checkRateLimit,
} from "@/lib/server/moviegoblin-service";

const attributeSchema = z.object({
  kind: z.enum(["director", "actor", "year", "genre", "language"]),
  value: z.string().trim().min(1, "Value cannot be empty.").max(100, "Value cannot exceed 100 characters."),
});

const attributeHits = new Map();

export async function POST(request: Request) {
  const limit = checkRateLimit(request, attributeHits, {
    windowMs: 60 * 1000,
    max: 60,
    message: "Too many attribute queries. Please slow down.",
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

  const parsed = attributeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid attribute payload." },
      { status: 400 }
    );
  }

  try {
    const result = await movieGoblinService.evaluateAttribute(
      parsed.data.kind,
      parsed.data.value
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json(
        { error: "Attribute evaluation unavailable. Catalog is currently unreachable." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
