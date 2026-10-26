import { NextResponse, type NextRequest } from "next/server";
import {
  movieGoblinService,
  CatalogUnavailableError,
  checkRateLimit,
} from "@/lib/server/moviegoblin-service";

const clueHits = new Map();

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, clueHits, {
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many clue requests. Please slow down.",
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawN = searchParams.get("n");
  const n = parseInt(rawN ?? "", 10);

  if (isNaN(n) || n < 1) {
    return NextResponse.json(
      { error: "Query parameter 'n' must be a positive integer." },
      { status: 400 }
    );
  }

  try {
    const clue = await movieGoblinService.getClue(n);
    if (!clue) {
      return NextResponse.json(
        { error: `Clue index ${n} is out of range.` },
        { status: 400 }
      );
    }
    return NextResponse.json(clue);
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json(
        { error: "Clue unavailable. Movie catalog is empty or unreachable." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
