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
  normalizeTitle,
  levenshteinDistance,
  cosineSimilarity,
  scoreToPercent,
  getSimilarityLabel,
  getTodayUTC,
} from "../src/services/moviegoblin.js";
import { createMovieGoblinRouter } from "../src/routes/moviegoblin.js";
import { createRateLimiter } from "../src/middleware/rate-limit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Test In-Memory Repository ────────────────────────────────────────────────

class MockMovieGoblinRepository implements IMovieGoblinRepository {
  private assignments = new Map<string, string>();

  constructor(private movies: CatalogMovie[]) {}

  async getAllActiveMovies(): Promise<CatalogMovie[]> {
    if (this.movies.length === 0) {
      throw new CatalogUnavailableError("Mock catalog is empty.");
    }
    return this.movies;
  }

  async getDailyAssignment(dateUTC: string): Promise<string | null> {
    return this.assignments.get(dateUTC) ?? null;
  }

  async createDailyAssignment(dateUTC: string, movieId: string): Promise<string> {
    if (!this.assignments.has(dateUTC)) {
      this.assignments.set(dateUTC, movieId);
    }
    return this.assignments.get(dateUTC)!;
  }

  async getDailyMovie(dateUTC: string): Promise<CatalogMovie> {
    const service = new MovieGoblinService(this);
    return service.getDailyMovie(dateUTC);
  }
}

// ─── In-Memory Request Dispatcher (No TCP Sockets) ────────────────────────────

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
      send(data: any) {
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

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("MovieGoblin Backend Core API", () => {
  let sampleMovies: CatalogMovie[];
  let targetMovie: CatalogMovie;
  let service: MovieGoblinService;
  let router: express.Router;

  before(async () => {
    // Load Phase 1 prepared fixture with real 384-dim embeddings
    const fixturePath = resolve(__dirname, "..", "scripts", "data", "curated-movies-prepared.json");
    const content = await readFile(fixturePath, "utf-8");
    const rawList = JSON.parse(content);

    sampleMovies = rawList.map((m: any, idx: number) => ({
      ...m,
      id: `test-movie-${idx + 1}`,
    }));

    const mockRepo = new MockMovieGoblinRepository(sampleMovies);
    service = new MovieGoblinService(mockRepo);
    targetMovie = await mockRepo.getDailyMovie(getTodayUTC());
    router = createMovieGoblinRouter(service);
  });

  // 1. Normalization & Math Unit Tests
  describe("Unit: String Normalization & Similarity", () => {
    test("normalizeTitle strips leading articles, punctuation, and lowercases", () => {
      assert.strictEqual(normalizeTitle("The Godfather: Part I"), "godfather part i");
      assert.strictEqual(normalizeTitle("A New Hope!"), "new hope");
      assert.strictEqual(normalizeTitle("   AN   Inception  "), "inception");
    });

    test("levenshteinDistance computes correct edit distances", () => {
      assert.strictEqual(levenshteinDistance("godfather", "godfaather"), 1);
      assert.strictEqual(levenshteinDistance("matrix", "matrx"), 1);
      assert.strictEqual(levenshteinDistance("inception", "incpetion"), 2);
      assert.strictEqual(levenshteinDistance("titanic", "avengers"), 8);
    });

    test("cosineSimilarity computes accurate vector similarity", () => {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0];
      const v3 = [0, 1, 0];
      assert.strictEqual(cosineSimilarity(v1, v2), 1.0);
      assert.strictEqual(cosineSimilarity(v1, v3), 0.0);
    });

    test("similarityToPercent and warmth labels are calibrated", () => {
      assert.strictEqual(scoreToPercent(0.85), 85);
      assert.strictEqual(scoreToPercent(-0.2), 0);
      assert.strictEqual(scoreToPercent(1.2), 100);

      assert.strictEqual(getSimilarityLabel(0.85), "Scorching");
      assert.strictEqual(getSimilarityLabel(0.70), "Very hot");
      assert.strictEqual(getSimilarityLabel(0.55), "Hot");
      assert.strictEqual(getSimilarityLabel(0.45), "Warm");
      assert.strictEqual(getSimilarityLabel(0.30), "Cool");
      assert.strictEqual(getSimilarityLabel(0.15), "Cold");
    });
  });

  // 2. GET /moviegoblin/daily
  describe("GET /moviegoblin/daily", () => {
    test("returns current UTC date and game limits", async () => {
      const res = await invokeRouter(router, { method: "GET", url: "/daily" });
      assert.strictEqual(res.status, 200);

      const data = res.body;
      assert.strictEqual(typeof data.date, "string");
      assert.strictEqual(data.maxGuesses, null);
      assert.strictEqual(data.status, "active");
    });

    test("CRITICAL: Answer leakage test - never reveals target details in GET /daily", async () => {
      const res = await invokeRouter(router, { method: "GET", url: "/daily" });
      const data = res.body;

      // Ensure secret fields are strictly absent
      assert.strictEqual(data.title, undefined, "Daily endpoint must not contain title");
      assert.strictEqual(data.plot, undefined, "Daily endpoint must not contain plot");
      assert.strictEqual(data.id, undefined, "Daily endpoint must not contain id");
      assert.strictEqual(data.movie_id, undefined, "Daily endpoint must not contain movie_id");
      assert.strictEqual(data.embedding, undefined, "Daily endpoint must not contain embedding");
      assert.strictEqual(data.clues, undefined, "Daily endpoint must not contain clues");

      // Verify no field matches target movie title string
      const jsonString = JSON.stringify(data);
      assert.ok(!jsonString.includes(targetMovie.title), "Target movie title leaked in response");
      assert.ok(!jsonString.includes(targetMovie.plot), "Target movie plot leaked in response");
    });
  });

  // 3. POST /moviegoblin/guess
  describe("POST /moviegoblin/guess", () => {
    test("rejects invalid or empty payloads with 400", async () => {
      const resEmpty = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "" },
      });
      assert.strictEqual(resEmpty.status, 400);

      const resMissing = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: {},
      });
      assert.strictEqual(resMissing.status, 400);
    });

    test("unknown movie guess returns recognized: false and does not penalize attempt", async () => {
      const res = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "Made Up Nonexistent Movie 12345" },
      });
      assert.strictEqual(res.status, 200);

      const data = res.body;
      assert.strictEqual(data.recognized, false);
      assert.strictEqual(typeof data.message, "string");
      assert.ok(data.message.includes("not recognized"));
      assert.strictEqual(data.similarity, undefined);
      assert.strictEqual(data.isCorrect, undefined);
    });

    test("correct guess reveals answer and marks isCorrect: true with 100% similarity", async () => {
      const res = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: targetMovie.title },
      });
      assert.strictEqual(res.status, 200);

      const data = res.body;
      assert.strictEqual(data.recognized, true);
      assert.strictEqual(data.isCorrect, true);
      assert.strictEqual(data.similarity, 100);
      assert.strictEqual(data.similarityLabel, "🎬 Correct!");
      assert.strictEqual(typeof data.revealedAnswer, "object");
      assert.strictEqual(data.revealedAnswer?.title, targetMovie.title);
      assert.strictEqual(data.revealedAnswer?.year, targetMovie.year);
    });

    test("incorrect recognized guess returns similarity and warmth without leaking answer", async () => {
      const otherMovie = sampleMovies.find((m) => m.id !== targetMovie.id)!;
      assert.ok(otherMovie, "Sample contains an alternate movie");

      const res = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: otherMovie.title },
      });
      assert.strictEqual(res.status, 200);

      const data = res.body;
      assert.strictEqual(data.recognized, true);
      assert.strictEqual(data.isCorrect, false);
      assert.strictEqual(typeof data.similarity, "number");
      assert.ok(data.similarity >= 0 && data.similarity <= 100);
      assert.strictEqual(typeof data.similarityLabel, "string");
      assert.strictEqual(data.matchedTitle, `${otherMovie.title} (${otherMovie.year})`);

      // Crucial: answer is hidden
      assert.strictEqual(data.revealedAnswer, undefined, "Answer must not be revealed for wrong guesses");
      const jsonString = JSON.stringify(data);
      assert.ok(!jsonString.includes(targetMovie.title), "Target title leaked in incorrect guess response");
    });

    test("typo matching: resolves small typos (Levenshtein <= 2)", async () => {
      const godfather = sampleMovies.find((m) => m.normalized_title === "godfather");
      if (godfather) {
        const res = await invokeRouter(router, {
          method: "POST",
          url: "/guess",
          body: { guess: "Godfaather" },
        });
        const data = res.body;
        assert.strictEqual(data.recognized, true);
        assert.ok(data.matchedTitle.includes(godfather.title));
      }
    });

    test("alias matching: resolves alternate movie titles", async () => {
      const starWars = sampleMovies.find((m) => m.aliases.includes("A New Hope"));
      if (starWars) {
        const res = await invokeRouter(router, {
          method: "POST",
          url: "/guess",
          body: { guess: "A New Hope" },
        });
        const data = res.body;
        assert.strictEqual(data.recognized, true);
        assert.ok(data.matchedTitle.includes(starWars.title));
      }
    });

    test("unlimited guesses: allows >6 incorrect guesses without failure and accepts correct guess", async () => {
      const otherMovies = sampleMovies.filter((m) => m.id !== targetMovie.id);
      assert.ok(otherMovies.length >= 2, "Requires at least 2 other movies");

      // Submit 8 consecutive incorrect guesses
      for (let i = 0; i < 8; i++) {
        const movie = otherMovies[i % otherMovies.length];
        const res = await invokeRouter(router, {
          method: "POST",
          url: "/guess",
          body: { guess: movie.title },
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.recognized, true);
        assert.strictEqual(res.body.isCorrect, false);
      }

      // Guess #9: submit the correct movie and verify victory
      const finalRes = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: targetMovie.title },
      });
      assert.strictEqual(finalRes.status, 200);
      assert.strictEqual(finalRes.body.recognized, true);
      assert.strictEqual(finalRes.body.isCorrect, true);
      assert.strictEqual(finalRes.body.similarity, 100);
      assert.strictEqual(finalRes.body.revealedAnswer?.title, targetMovie.title);
    });

    test("movie recognition: recognizes Fight Club, Baahubali, The Godfather, and Inception", async () => {
      const titlesToTest = [
        { guess: "Fight Club", expectedTitle: "Fight Club" },
        { guess: "Baahubali", expectedTitle: "Baahubali: The Beginning" },
        { guess: "The Godfather", expectedTitle: "The Godfather" },
        { guess: "Inception", expectedTitle: "Inception" },
      ];

      for (const item of titlesToTest) {
        const res = await invokeRouter(router, {
          method: "POST",
          url: "/guess",
          body: { guess: item.guess },
        });
        assert.strictEqual(res.status, 200, `POST /guess for '${item.guess}' should be 200`);
        assert.strictEqual(res.body.recognized, true, `'${item.guess}' must be recognized in catalog`);
        assert.ok(
          res.body.matchedTitle.includes(item.expectedTitle),
          `Matched title for '${item.guess}' should contain '${item.expectedTitle}', got '${res.body.matchedTitle}'`
        );
      }
    });

    test("alternate titles & transliterations: recognizes Bahubali spelling and Godfather 2 sequel", async () => {
      // Alternate spelling: Bahubali (single 'a')
      const resBahubali = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "Bahubali" },
      });
      assert.strictEqual(resBahubali.status, 200);
      assert.strictEqual(resBahubali.body.recognized, true);
      assert.ok(resBahubali.body.matchedTitle.includes("Baahubali"));

      // Sequel alias: The Godfather 2
      const resGodfather2 = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "The Godfather 2" },
      });
      assert.strictEqual(resGodfather2.status, 200);
      assert.strictEqual(resGodfather2.body.recognized, true);
      assert.ok(resGodfather2.body.matchedTitle.includes("The Godfather: Part II"));
    });

    test("duplicate titles & remakes: disambiguates Batman (1989) vs Batman (1966) without merging", async () => {
      // Batman 1989
      const res89 = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "Batman (1989)" },
      });
      assert.strictEqual(res89.status, 200);
      assert.strictEqual(res89.body.recognized, true);
      assert.ok(res89.body.matchedTitle.includes("1989"));

      // Batman 1966
      const res66 = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "Batman (1966)" },
      });
      assert.strictEqual(res66.status, 200);
      assert.strictEqual(res66.body.recognized, true);
      assert.ok(res66.body.matchedTitle.includes("1966"));

      // Adavi Ramudu (1977) vs (2004)
      const resAdavi04 = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "Adavi Ramudu (2004)" },
      });
      assert.strictEqual(resAdavi04.status, 200);
      assert.strictEqual(resAdavi04.body.recognized, true);
      assert.ok(resAdavi04.body.matchedTitle.includes("2004"));
    });
  });

  // 4. Fallback Protection & Error Handling
  describe("Error Handling: No Fallback Answers Invented", () => {
    test("returns 503 if database/catalog is unavailable (does not invent fake answer)", async () => {
      const emptyRepo = new MockMovieGoblinRepository([]);
      const emptyService = new MovieGoblinService(emptyRepo);
      const emptyRouter = createMovieGoblinRouter(emptyService);

      const resDaily = await invokeRouter(emptyRouter, { method: "GET", url: "/daily" });
      assert.strictEqual(resDaily.status, 503);
      assert.ok(resDaily.body.error.includes("unavailable"));

      const resGuess = await invokeRouter(emptyRouter, {
        method: "POST",
        url: "/guess",
        body: { guess: "Inception" },
      });
      assert.strictEqual(resGuess.status, 503);
      assert.ok(resGuess.body.error.includes("unavailable"));
    });
  });

  // 5. Rate Limiting Tests
  describe("Rate Limiting", () => {
    test("returns 429 when rate limit is exceeded", async () => {
      const strictLimiter = createRateLimiter({ windowMs: 10000, max: 2, message: "Limit hit." });
      const testRouter = express.Router();
      testRouter.get("/test-limit", strictLimiter, (_req, res) => res.json({ ok: true }));

      const r1 = await invokeRouter(testRouter, { method: "GET", url: "/test-limit", ip: "192.168.1.100" });
      assert.strictEqual(r1.status, 200);

      const r2 = await invokeRouter(testRouter, { method: "GET", url: "/test-limit", ip: "192.168.1.100" });
      assert.strictEqual(r2.status, 200);

      // 3rd request should hit the limit (max: 2)
      const r3 = await invokeRouter(testRouter, { method: "GET", url: "/test-limit", ip: "192.168.1.100" });
      assert.strictEqual(r3.status, 429);
      assert.strictEqual(r3.body.error, "Limit hit.");
      assert.ok(r3.headers["retry-after"]);
    });
  });
});
