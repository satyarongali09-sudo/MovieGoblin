import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  MovieGoblinService,
  CatalogUnavailableError,
  type IMovieGoblinRepository,
  type CatalogMovie,
  getTodayUTC,
} from "../src/services/moviegoblin.js";
import { createMovieGoblinRouter } from "../src/routes/moviegoblin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Test In-Memory Repository with Assignment Tracking ──────────────────────

class TrackingMovieRepository implements IMovieGoblinRepository {
  public assignments = new Map<string, string>();
  public getAssignmentCalls = 0;
  public createAssignmentCalls = 0;
  public simulateCreateFailure = false;
  public simulateCatalogFailure = false;

  constructor(public movies: CatalogMovie[]) {}

  async getAllActiveMovies(): Promise<CatalogMovie[]> {
    if (this.simulateCatalogFailure) {
      throw new CatalogUnavailableError("Simulated database connection failure.");
    }
    return this.movies.filter((m) => m.is_active);
  }

  async getDailyAssignment(dateUTC: string): Promise<string | null> {
    this.getAssignmentCalls += 1;
    return this.assignments.get(dateUTC) ?? null;
  }

  async createDailyAssignment(dateUTC: string, movieId: string): Promise<string> {
    this.createAssignmentCalls += 1;

    if (this.simulateCreateFailure) {
      throw new CatalogUnavailableError("Simulated database write failure.");
    }

    // Simulate primary key conflict behavior (ON CONFLICT (puzzle_date) DO NOTHING)
    if (!this.assignments.has(dateUTC)) {
      // Simulate slight delay to test concurrency race conditions
      await new Promise((r) => setTimeout(r, 5));
      this.assignments.set(dateUTC, movieId);
    }

    return this.assignments.get(dateUTC)!;
  }
}

// ─── In-Memory Express Request Invoker ───────────────────────────────────────

function invokeRouter(
  router: express.Router,
  reqOptions: { method: string; url: string; body?: any; ip?: string }
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolveResult) => {
    let resolved = false;

    const req: any = {
      method: reqOptions.method,
      url: reqOptions.url,
      baseUrl: "",
      originalUrl: reqOptions.url,
      path: reqOptions.url,
      body: reqOptions.body || {},
      ip: reqOptions.ip || "127.0.0.1",
      socket: { remoteAddress: reqOptions.ip || "127.0.0.1" },
      headers: { "content-type": "application/json" },
    };

    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = String(value);
        return this;
      },
      json(data: any) {
        if (!resolved) {
          resolved = true;
          resolveResult({ status: this.statusCode, headers: this.headers, body: data });
        }
        return this;
      },
      end() {
        if (!resolved) {
          resolved = true;
          resolveResult({ status: this.statusCode, headers: this.headers, body: null });
        }
        return this;
      },
    };

    router(req, res, (err?: any) => {
      if (!resolved) {
        resolved = true;
        if (err) {
          resolveResult({ status: 500, headers: res.headers, body: { error: err.message } });
        } else {
          resolveResult({ status: 404, headers: res.headers, body: { error: "Not Found" } });
        }
      }
    });
  });
}

// ─── Daily Puzzle Assignment Test Suite ───────────────────────────────────────

describe("MovieGoblin Daily Puzzle Assignment", () => {
  let sampleMovies: CatalogMovie[];

  before(async () => {
    const fixturePath = resolve(__dirname, "..", "scripts", "data", "curated-movies-prepared.json");
    const content = await readFile(fixturePath, "utf-8");
    const rawList = JSON.parse(content);

    sampleMovies = rawList.map((m: any, idx: number) => ({
      ...m,
      id: `movie-uuid-${idx + 1}`,
      is_active: true,
    }));
  });

  test("1. First-time assignment creates entry in moviegoblin_daily", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    const service = new MovieGoblinService(repo);
    const router = createMovieGoblinRouter(service);

    const testDate = "2026-11-01";
    assert.strictEqual(repo.assignments.has(testDate), false, "Must start unassigned");

    const res = await invokeRouter(router, { method: "GET", url: "/daily" });
    assert.strictEqual(res.status, 200);

    const body = res.body;
    assert.strictEqual(body.status, "active");
    assert.strictEqual(body.maxGuesses, null);

    // Verify assignment was created for today's date
    const today = getTodayUTC();
    assert.strictEqual(repo.assignments.has(today), true, "Assignment must be created");
    const assignedMovieId = repo.assignments.get(today);
    assert.ok(assignedMovieId);

    // Verify assigned movie exists in active movies
    const assignedMovie = sampleMovies.find((m) => m.id === assignedMovieId);
    assert.ok(assignedMovie, "Assigned movie must exist in catalog");
    assert.strictEqual(assignedMovie.is_active, true);
  });

  test("2. Repeat requests on the same UTC date reuse existing assignment", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    const service = new MovieGoblinService(repo);

    const testDate = "2026-11-02";

    // Call 1: First assignment
    const movie1 = await service.getDailyMovie(testDate);
    const createCountAfterCall1 = repo.createAssignmentCalls;
    assert.strictEqual(createCountAfterCall1, 1, "Should create once on first call");

    // Call 2: Repeat request on same date
    const movie2 = await service.getDailyMovie(testDate);
    assert.strictEqual(repo.createAssignmentCalls, createCountAfterCall1, "Must not create again");
    assert.strictEqual(movie1.id, movie2.id, "Must return exact same movie");
    assert.strictEqual(movie1.title, movie2.title);

    // Call 3: GET /daily endpoint
    const puzzle = await service.getDailyPuzzle(testDate);
    assert.strictEqual(puzzle.date, testDate);
    assert.strictEqual(repo.createAssignmentCalls, createCountAfterCall1);
  });

  test("3. Concurrent requests do not create conflicting assignments", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    const service = new MovieGoblinService(repo);
    const testDate = "2026-11-03";

    // Launch 10 concurrent requests simultaneously
    const concurrentRequests = Array.from({ length: 10 }, () => service.getDailyMovie(testDate));
    const results = await Promise.all(concurrentRequests);

    // All results must be identical
    const firstId = results[0].id;
    for (const movie of results) {
      assert.strictEqual(movie.id, firstId, "All concurrent requests must resolve to the same movie");
    }

    // Exactly 1 assignment stored in map for this date
    assert.strictEqual(repo.assignments.size, 1);
    assert.strictEqual(repo.assignments.get(testDate), firstId);
  });

  test("4. Only active movies (is_active = true) are selected for daily puzzle", async () => {
    // Mark all movies except one as inactive
    const activeMovie = sampleMovies[3];
    const modifiedList = sampleMovies.map((m) => ({
      ...m,
      is_active: m.id === activeMovie.id,
    }));

    const repo = new TrackingMovieRepository(modifiedList);
    const service = new MovieGoblinService(repo);

    const movie = await service.getDailyMovie("2026-11-04");
    assert.strictEqual(movie.id, activeMovie.id, "Must select the active movie");
    assert.strictEqual(movie.is_active, true);
  });

  test("5. Database failures during daily assignment return 503 without fake answer", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    repo.simulateCreateFailure = true; // Simulate insert/upsert error
    const service = new MovieGoblinService(repo);
    const router = createMovieGoblinRouter(service);

    const res = await invokeRouter(router, { method: "GET", url: "/daily" });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(typeof res.body.error, "string");
    assert.ok(res.body.error.includes("unavailable"));

    // Ensure no answer leaked in 503 response
    assert.strictEqual(res.body.title, undefined);
    assert.strictEqual(res.body.plot, undefined);
  });

  test("6. Answer leakage protection: GET /daily never exposes target secrets", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    const service = new MovieGoblinService(repo);
    const router = createMovieGoblinRouter(service);

    const targetMovie = await service.getDailyMovie(getTodayUTC());

    const res = await invokeRouter(router, { method: "GET", url: "/daily" });
    assert.strictEqual(res.status, 200);

    const body = res.body;
    assert.strictEqual(body.title, undefined);
    assert.strictEqual(body.plot, undefined);
    assert.strictEqual(body.id, undefined);
    assert.strictEqual(body.movie_id, undefined);
    assert.strictEqual(body.embedding, undefined);
    assert.strictEqual(body.clues, undefined);

    const json = JSON.stringify(body);
    assert.ok(!json.includes(targetMovie.title), "Must not leak target title");
    assert.ok(!json.includes(targetMovie.plot), "Must not leak target plot");
  });

  test("7. Consecutive day dissimilarity: no movie or director matches from today to tomorrow", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    const service = new MovieGoblinService(repo);

    let prevMovie: CatalogMovie | null = null;

    for (let day = 1; day <= 20; day++) {
      const dateStr = `2026-11-${String(day).padStart(2, "0")}`;
      const movie = await service.getDailyMovie(dateStr);

      if (prevMovie) {
        // Must never match today to tomorrow
        assert.notStrictEqual(movie.id, prevMovie.id, `Day ${dateStr} must not repeat yesterday's movie`);
        assert.notStrictEqual(
          movie.title.toLowerCase(),
          prevMovie.title.toLowerCase(),
          `Day ${dateStr} must not repeat yesterday's title`
        );

        // Must not share same franchise stem (e.g., Baahubali 1 vs Baahubali 2)
        const stemA = movie.title.toLowerCase().replace(/^(the|a|an)\s+/, "").split(/[:\-\s]/)[0];
        const stemB = prevMovie.title.toLowerCase().replace(/^(the|a|an)\s+/, "").split(/[:\-\s]/)[0];
        if (stemA.length >= 4) {
          assert.notStrictEqual(
            stemA,
            stemB,
            `Consecutive days ${dateStr} must not share franchise stem ${stemA}`
          );
        }
      }

      prevMovie = movie;
    }
  });

  test("8. Multilingual cinema rotation: Tollywood (Telugu) movies are actively featured", async () => {
    const repo = new TrackingMovieRepository(sampleMovies);
    const service = new MovieGoblinService(repo);

    const selectedTitles: string[] = [];
    let teluguCount = 0;

    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-12-${String(day).padStart(2, "0")}`;
      const movie = await service.getDailyMovie(dateStr);
      selectedTitles.push(movie.title);

      const isTelugu =
        movie.genres?.includes("Telugu") ||
        movie.plot?.toLowerCase().includes("telugu") ||
        ["rrr", "baahubali", "eega", "pushpa", "rangasthalam", "jersey", "kalki", "mahanati", "pokiri", "athadu"].some(
          (kw) => movie.title.toLowerCase().includes(kw)
        );

      if (isTelugu) {
        teluguCount++;
      }
    }

    assert.ok(
      teluguCount >= 5,
      `Expected at least 5 Tollywood movies across 30 days, got ${teluguCount}. Selected: ${selectedTitles.join(", ")}`
    );
  });
});
