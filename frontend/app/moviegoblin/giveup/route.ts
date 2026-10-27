import { NextResponse } from "next/server";
import {
  movieGoblinService,
  CatalogUnavailableError,
  checkRateLimit,
} from "@/lib/server/moviegoblin-service";

const giveUpHits = new Map();

export async function POST(request: Request) {
  const limit = checkRateLimit(request, giveUpHits, {
    windowMs: 60 * 1000,
    max: 10,
    message: "Too many give-up requests. Please slow down.",
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );
  }

  try {
    const answer = await movieGoblinService.giveUp();
    return NextResponse.json(answer, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json(
        { error: "Give up unavailable. Movie catalog is empty or unreachable." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
