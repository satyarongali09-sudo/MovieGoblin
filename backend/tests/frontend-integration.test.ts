process.env.NODE_ENV = "test";
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

class MockMovieGoblinRepository implements IMovieGoblinRepository {
  private assignments = new Map<string, string>();

  constructor(private movies: CatalogMovie[]) {}

  async getAllActiveMovies(): Promise<CatalogMovie[]> {
    if (this.movies.length === 0) {
      throw new CatalogUnavailableError("Catalog is empty.");
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

describe("Frontend Client API Integration Contract", () => {
  let sampleMovies: CatalogMovie[];
  let targetMovie: CatalogMovie;
  let service: MovieGoblinService;
  let router: express.Router;

  before(async () => {
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

  test("Contract 1: GET /daily response satisfies frontend DailyGame type", async () => {
    const res = await invokeRouter(router, { method: "GET", url: "/daily" });
    assert.strictEqual(res.status, 200);

    const body = res.body;
    // Expected type: { date: string, maxGuesses?: number | null, status: "active" }
    assert.strictEqual(typeof body.date, "string");
    assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(body.maxGuesses, null);
    assert.strictEqual(body.status, "active");

    // Must never leak target movie info
    assert.strictEqual(body.title, undefined);
    assert.strictEqual(body.plot, undefined);
    assert.strictEqual(body.id, undefined);
    assert.strictEqual(body.embedding, undefined);
  });

  test("Contract 2: POST /guess for correct guess returns revealedAnswer with title and year", async () => {
    const res = await invokeRouter(router, {
      method: "POST",
      url: "/guess",
      body: { guess: targetMovie.title },
    });
    assert.strictEqual(res.status, 200);

    const body = res.body;
    assert.strictEqual(body.recognized, true);
    assert.strictEqual(body.isCorrect, true);
    assert.strictEqual(body.similarity, 100);
    assert.strictEqual(body.similarityLabel, "🎬 Correct!");
    assert.strictEqual(typeof body.revealedAnswer, "object");
    assert.strictEqual(body.revealedAnswer.title, targetMovie.title);
    assert.strictEqual(body.revealedAnswer.year, targetMovie.year);
  });

  test("Contract 3: POST /guess for wrong recognized guess returns similarity but NO revealedAnswer", async () => {
    const otherMovie = sampleMovies.find((m) => m.id !== targetMovie.id)!;
    const res = await invokeRouter(router, {
      method: "POST",
      url: "/guess",
      body: { guess: otherMovie.title },
    });
    assert.strictEqual(res.status, 200);

    const body = res.body;
    assert.strictEqual(body.recognized, true);
    assert.strictEqual(body.isCorrect, false);
    assert.strictEqual(typeof body.similarity, "number");
    assert.ok(body.similarity >= 0 && body.similarity <= 100);
    assert.strictEqual(typeof body.similarityLabel, "string");
    assert.strictEqual(typeof body.matchedTitle, "string");
    assert.strictEqual(body.revealedAnswer, undefined, "Wrong guesses must not reveal the answer");
  });

  test("Contract 4: POST /guess for unknown movie returns recognized: false and friendly message", async () => {
    const res = await invokeRouter(router, {
      method: "POST",
      url: "/guess",
      body: { guess: "Completely Fake Movie 999" },
    });
    assert.strictEqual(res.status, 200);

    const body = res.body;
    assert.strictEqual(body.recognized, false);
    assert.strictEqual(typeof body.message, "string");
    assert.ok(body.message.length > 5);
    // Guarantees frontend knows attempt is NOT consumed:
    assert.strictEqual(body.similarity, undefined);
    assert.strictEqual(body.isCorrect, undefined);
  });

  test("Contract 5: 503 error contract when catalog is empty or unavailable", async () => {
    const emptyRepo = new MockMovieGoblinRepository([]);
    const emptyService = new MovieGoblinService(emptyRepo);
    const emptyRouter = createMovieGoblinRouter(emptyService);

    const res = await invokeRouter(emptyRouter, { method: "GET", url: "/daily" });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(typeof res.body.error, "string");
    assert.ok(res.body.error.includes("unavailable"));
  });

  test("Contract 6: CORS origin validation permits both port 3000 and 3001", async () => {
    const { isAllowedOrigin } = await import("../src/server.js");
    assert.strictEqual(isAllowedOrigin("http://localhost:3000"), true, "Port 3000 must be allowed");
    assert.strictEqual(isAllowedOrigin("http://localhost:3001"), true, "Port 3001 must be allowed");
    assert.strictEqual(isAllowedOrigin("http://127.0.0.1:3001"), true, "127.0.0.1:3001 must be allowed in dev");
    assert.strictEqual(isAllowedOrigin(undefined), true, "Direct/curl requests with no Origin must be allowed");
    assert.strictEqual(isAllowedOrigin("http://untrusted-site.com"), false, "External untrusted origins must be blocked");
  });
});
