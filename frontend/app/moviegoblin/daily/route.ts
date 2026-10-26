import { NextResponse } from "next/server";
import {
  movieGoblinService,
  CatalogUnavailableError,
  checkRateLimit,
} from "@/lib/server/moviegoblin-service";

const dailyHits = new Map();

export async function GET(request: Request) {
  const limit = checkRateLimit(request, dailyHits, {
    windowMs: 60 * 1000,
    max: 60,
    message: "Too many requests for daily puzzle. Please slow down.",
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );
  }

  try {
    const dailyInfo = await movieGoblinService.getDailyPuzzle();
    return NextResponse.json(dailyInfo);
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      return NextResponse.json(
        { error: "Daily puzzle is currently unavailable. Movie catalog is empty or unreachable." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
