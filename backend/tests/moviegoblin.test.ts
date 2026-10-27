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
  selectDailyTarget,
} from "../src/services/moviegoblin.js";
import { createMovieGoblinRouter } from "../src/routes/moviegoblin.js";
import { createRateLimiter } from "../src/middleware/rate-limit.js";
import {
  sanitize9000Csv,
  parseCSV,
  loadCombinedCsvDataset,
} from "../src/services/moviegoblin-csv.js";

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

  // 6. Expanded Dataset Integration, Deduplication, Poster Data Flow & Secrecy
  describe("Expanded Dataset Integration, Poster Data Flow & Secrecy", () => {
    test("sanitize9000Csv fixes unquoted multiline overview without dropping records", () => {
      const brokenSnippet =
        `2013-10-20,Pixie Hollow Bake Off,Tink challenges Gelata to see who can bake the best cake for the queen's party.  Plus 10 Disney Fairies Mini-Shorts:\n` +
        ` - Just Desserts\n` +
        ` - If The Hue Fits\n` +
        ` - Magic Tricks,61.328,35,7.1,en,Animation,https://image.tmdb.org/t/p/original/6iXYe7AkQ1QIfMFuvXsSCT2zF7s.jpg\n`;

      const sanitized = sanitize9000Csv(brokenSnippet);
      const rows = parseCSV(sanitized);

      assert.strictEqual(rows.length, 1, "Multiline snippet should be sanitized into exactly 1 row");
      assert.strictEqual(rows[0].length, 9, "Sanitized row must have 9 columns");
      assert.strictEqual(rows[0][1], "Pixie Hollow Bake Off");
      assert.ok(rows[0][2].includes("Just Desserts"));
      assert.strictEqual(rows[0][7], "Animation");
    });

    test("loadCombinedCsvDataset merges 9000plus.csv and yields >13,000 films", () => {
      const dataset = loadCombinedCsvDataset();
      assert.ok(dataset.movies.length > 13000, `Expected >13,000 movies, got ${dataset.movies.length}`);
      assert.ok(Object.keys(dataset.metaByKey).length > 13000, "metaByKey should cover all movies");
    });

    test("preserves existing director and cast while enriching with poster_url", () => {
      const dataset = loadCombinedCsvDataset();
      const inception = dataset.movies.find(
        (m) => m.normalized_title === "inception" && m.year === 2010
      );
      assert.ok(inception, "Inception (2010) must be present in catalog");

      const meta = dataset.metaByKey["inception::2010"];
      assert.ok(meta, "Metadata for Inception must exist");
      assert.strictEqual(meta.director, "Christopher Nolan");
      assert.ok(meta.cast.length > 0, "Inception must preserve cast members");
      assert.ok(inception.poster_url || meta.poster_url, "Inception must have poster_url enriched");
    });

    test("recognizes new 2021 releases from 9000plus.csv in catalog resolution", () => {
      const dataset = loadCombinedCsvDataset();
      const spiderman = dataset.movies.find((m) =>
        m.title.includes("Spider-Man: No Way Home")
      );
      assert.ok(spiderman, "Spider-Man: No Way Home should be present in merged catalog");
      assert.strictEqual(spiderman.year, 2021);
      assert.ok(spiderman.poster_url, "Spider-Man: No Way Home should have a poster URL");
    });

    test("remake disambiguation: The Batman (2022) vs Batman (1989)", () => {
      const dataset = loadCombinedCsvDataset();
      const batman22 = dataset.movies.find(
        (m) => m.year === 2022 && m.title.toLowerCase().includes("batman")
      );
      const batman89 = dataset.movies.find(
        (m) => m.year === 1989 && m.title.toLowerCase().includes("batman")
      );

      assert.ok(batman22, "The Batman (2022) must be in catalog");
      assert.ok(batman89, "Batman (1989) must be in catalog");
      assert.notStrictEqual(batman22.id, batman89.id, "Remakes must have distinct catalog IDs");
    });

    test("missing metadata safety: movie without director/cast evaluates without throwing", async () => {
      const movieNoCredits: CatalogMovie = {
        id: "csv-9000-test",
        title: "Creditless Indie Film",
        normalized_title: "creditless indie film",
        aliases: [],
        year: 2021,
        genres: ["Drama"],
        plot: "An indie film with no verified director or cast metadata available in the source CSV.",
        embedding: new Array(384).fill(0.05),
        is_active: true,
      };

      const customRepo = new MockMovieGoblinRepository([...sampleMovies, movieNoCredits]);
      const customService = new MovieGoblinService(customRepo);

      const result = await customService.evaluateGuess("Creditless Indie Film");
      assert.strictEqual(result.recognized, true);
      assert.strictEqual(result.isCorrect, false);
      assert.strictEqual(typeof result.similarity, "number");
      assert.ok(result.similarity >= 0 && result.similarity <= 100);
    });

    test("poster data flow: POST /guess returns poster_url for recognized candidate", async () => {
      const movieWithPoster: CatalogMovie = {
        id: "test-poster-movie",
        title: "Poster Test Movie",
        normalized_title: "poster test movie",
        aliases: [],
        year: 2022,
        genres: ["Action"],
        plot: "A test film with a poster.",
        embedding: new Array(384).fill(0.05),
        is_active: true,
        poster_url: "https://image.tmdb.org/t/p/original/testposter.jpg",
      };

      const customRepo = new MockMovieGoblinRepository([...sampleMovies, movieWithPoster]);
      const customService = new MovieGoblinService(customRepo);
      const customRouter = createMovieGoblinRouter(customService);

      const res = await invokeRouter(customRouter, {
        method: "POST",
        url: "/guess",
        body: { guess: "Poster Test Movie" },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.recognized, true);
      assert.strictEqual(
        res.body.poster_url,
        "https://image.tmdb.org/t/p/original/testposter.jpg"
      );
    });

    test("answer secrecy: incorrect guess NEVER leaks target movie's poster or title", async () => {
      const res = await invokeRouter(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "Fight Club" },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.recognized, true);

      // If target is not Fight Club, target's poster or revealedAnswer must NOT be present
      if (!res.body.isCorrect) {
        assert.strictEqual(res.body.revealedAnswer, undefined);
        const jsonStr = JSON.stringify(res.body);
        assert.ok(!jsonStr.includes(targetMovie.title), "Target title leaked in incorrect guess");
      }
    });

    test("selectDailyTarget invariant: candidate without director and cast is NEVER selected as daily target", () => {
      const incompleteCandidate: CatalogMovie = {
        id: "csv-incomplete",
        title: "Incomplete Film",
        normalized_title: "incomplete film",
        aliases: [],
        year: 2022,
        genres: ["Drama"],
        plot: "This film has no director or cast metadata whatsoever.",
        embedding: new Array(384).fill(0.05),
        is_active: true,
      };

      const pool = [...sampleMovies, incompleteCandidate];
      const target = selectDailyTarget(pool, "2026-10-28");

      assert.notStrictEqual(
        target.id,
        "csv-incomplete",
        "selectDailyTarget must never select candidate lacking director/cast"
      );
    });

    test("GET /search returns poster_url in movie suggestion results", async () => {
      const movieWithPoster: CatalogMovie = {
        id: "search-poster-movie",
        title: "Searchable Poster Film",
        normalized_title: "searchable poster film",
        aliases: [],
        year: 2023,
        genres: ["Sci-Fi"],
        plot: "A film with a valid poster URL for search.",
        embedding: new Array(384).fill(0.05),
        is_active: true,
        poster_url: "https://image.tmdb.org/t/p/w500/searchable.jpg",
      };

      const customRepo = new MockMovieGoblinRepository([...sampleMovies, movieWithPoster]);
      const customService = new MovieGoblinService(customRepo);
      const customRouter = createMovieGoblinRouter(customService);

      const res = await invokeRouter(customRouter, {
        method: "GET",
        url: "/search?q=Searchable",
      });

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.results));
      const found = res.body.results.find((m: any) => m.title === "Searchable Poster Film");
      assert.ok(found, "Candidate must be found in suggestions");
      assert.strictEqual(found.poster_url, "https://image.tmdb.org/t/p/w500/searchable.jpg");
    });

    test("POST /giveup returns target poster_url in revealed answer", async () => {
      const movieWithPoster: CatalogMovie = {
        id: "daily-target-poster",
        title: "Daily Target With Poster",
        normalized_title: "daily target with poster",
        aliases: [],
        year: 2020,
        director: "Master Director",
        cast: ["Star Actor"],
        genres: ["Drama"],
        plot: "The plot of daily target.",
        embedding: new Array(384).fill(0.05),
        is_active: true,
        poster_url: "https://image.tmdb.org/t/p/original/targetposter.jpg",
      };

      const customRepo = new MockMovieGoblinRepository([movieWithPoster]);
      const customService = new MovieGoblinService(customRepo);
      const customRouter = createMovieGoblinRouter(customService);

      const res = await invokeRouter(customRouter, {
        method: "POST",
        url: "/giveup",
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.revealedAnswer, "Revealed answer must be returned");
      assert.strictEqual(
        res.body.revealedAnswer.poster_url,
        "https://image.tmdb.org/t/p/original/targetposter.jpg"
      );
    });
  });
});
