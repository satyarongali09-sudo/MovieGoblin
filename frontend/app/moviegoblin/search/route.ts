import { NextResponse, type NextRequest } from "next/server";
import {
  movieGoblinService,
  CatalogUnavailableError,
  checkRateLimit,
} from "@/lib/server/moviegoblin-service";

const searchHits = new Map();

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, searchHits, {
    windowMs: 60 * 1000,
    max: 240,
    message: "Too many searches. Please slow down.",
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 1) {
    return NextResponse.json({ results: [], attributes: [] });
  }

  try {
    const [results, attributes] = await Promise.all([
      movieGoblinService.searchMovies(q, 40),
      movieGoblinService.searchCatalogAttributes(q, 8),
    ]);
    return NextResponse.json({ results, attributes });
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json({ results: [], attributes: [] });
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
