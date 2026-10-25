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
  cosineSimilarity,
  mergeCatalogWithCombinedCsv,
} from "../src/services/moviegoblin.js";
import {
  buildClues,
  buildGuessHints,
  computeMatchPercent,
  evaluateAttributeGuess,
  maskPlot,
  searchAttributes,
  searchCatalog,
} from "../src/services/moviegoblin-game.js";
import { createMovieGoblinRouter } from "../src/routes/moviegoblin.js";

process.env.NODE_ENV = "test";

const __dirname = dirname(fileURLToPath(import.meta.url));

class MockRepo implements IMovieGoblinRepository {
  private assignments = new Map<string, string>();
  constructor(private movies: CatalogMovie[]) {}
  async getAllActiveMovies() {
    if (this.movies.length === 0) throw new CatalogUnavailableError("empty");
    return this.movies;
  }
  async getDailyAssignment(d: string) {
    return this.assignments.get(d) ?? null;
  }
  async createDailyAssignment(d: string, id: string) {
    if (!this.assignments.has(d)) this.assignments.set(d, id);
    return this.assignments.get(d)!;
  }
}

function invoke(
  router: express.Router,
  opts: { method: string; url: string; body?: unknown }
): Promise<{ status: number; body: any }> {
  return new Promise((done) => {
    let finished = false;
    const finish = (status: number, body: unknown) => {
      if (!finished) {
        finished = true;
        done({ status, body });
      }
    };
    const req: any = {
      method: opts.method,
      url: opts.url,
      baseUrl: "",
      originalUrl: opts.url,
      path: opts.url.split("?")[0],
      body: opts.body ?? {},
      ip: `10.0.0.${Math.floor(Math.random() * 250)}`,
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "content-type": "application/json" },
    };
    const res: any = {
      statusCode: 200,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      setHeader() {
        return this;
      },
      json(d: unknown) {
        finish(this.statusCode, d);
        return this;
      },
      send(d: unknown) {
        finish(this.statusCode, d);
        return this;
      },
      end() {
        finish(this.statusCode, null);
        return this;
      },
    };
    router(req, res, (err?: any) =>
      finish(err ? 500 : 404, { error: err ? err.message : "Not Found" })
    );
  });
}

describe("MovieGoblin Gameplay Features", () => {
  let movies: CatalogMovie[];
  let target: CatalogMovie;
  let service: MovieGoblinService;
  let router: express.Router;
  const byTitle = (t: string, y?: number) =>
    movies.find((m) => m.title === t && (y === undefined || m.year === y))!;

  before(async () => {
    const raw = JSON.parse(
      await readFile(resolve(__dirname, "..", "scripts", "data", "curated-movies-prepared.json"), "utf-8")
    );
    movies = raw.map((m: any, i: number) => ({ ...m, id: `m-${i + 1}` }));
    const repo = new MockRepo(movies);
    service = new MovieGoblinService(repo);
    target = await service.getDailyMovie(getTodayUTC());
    router = createMovieGoblinRouter(service);
  });

  describe("Search / autocomplete", () => {
    test("suggests only catalog titles, ranked by prefix", async () => {
      const res = await invoke(router, { method: "GET", url: "/search?q=god" });
      assert.equal(res.status, 200);
      const labels = res.body.results.map((r: any) => r.label);
      assert.ok(labels.includes("The Godfather (1972)"));
      assert.ok(labels.includes("The Godfather: Part II (1974)"));
      for (const r of res.body.results) {
        assert.ok(movies.some((m) => m.title === r.title && m.year === r.year));
        assert.equal(r.id, undefined);
      }
    });

    test("returns nothing for junk words like 'high' and empty queries, while supporting 1-character searches", async () => {
      assert.deepEqual((await invoke(router, { method: "GET", url: "/search?q=high" })).body.results, []);
      assert.deepEqual((await invoke(router, { method: "GET", url: "/search" })).body.results, []);
      const bRes = await invoke(router, { method: "GET", url: "/search?q=b" });
      assert.equal(bRes.status, 200);
      assert.ok(bRes.body.results.length > 0, "1-character query 'b' should return matching movies");
    });

    test("full combined CSV dataset (6,154 movies) supports 'A', 'R', 'B', and 'Z' searches", () => {
      const fullCatalog = mergeCatalogWithCombinedCsv(movies);
      assert.ok(fullCatalog.length >= 6150, `Expected >= 6150 movies, got ${fullCatalog.length}`);

      // 'A' search (including titles starting with 'A ' like A Beautiful Mind / Adavi Ramudu / Avatar)
      const aResults = searchCatalog("A", fullCatalog, 50);
      assert.ok(aResults.length >= 30, `'A' search should return at least 30 movies, got ${aResults.length}`);
      assert.ok(aResults.some((m) => m.title.startsWith("A ") || m.title.startsWith("A")), "'A' search should include titles starting with A");

      const aBeautiful = searchCatalog("A Beautiful Mind", fullCatalog, 10);
      assert.ok(aBeautiful.some((m) => m.title === "A Beautiful Mind" && m.year === 2001));

      // 'R' search (Raiders of the Lost Ark, Rangasthalam, Race Gurram, etc.)
      const rResults = searchCatalog("R", fullCatalog, 50);
      assert.ok(rResults.length >= 30, `'R' search should return at least 30 movies, got ${rResults.length}`);
      assert.ok(rResults.some((m) => /^r/i.test(m.title)));
      const rangasthalamResults = searchCatalog("Rangasthalam", fullCatalog, 10);
      assert.ok(rangasthalamResults.some((m) => m.title === "Rangasthalam"));

      // 'B' search (Baahubali, Batman, etc.)
      const bResults = searchCatalog("B", fullCatalog, 50);
      assert.ok(bResults.length >= 30, `'B' search should return at least 30 movies, got ${bResults.length}`);
      assert.ok(bResults.some((m) => m.title.startsWith("Baahubali") || m.title.startsWith("Batman")));

      // 'Z' search (Zootopia, Zodiac, etc.)
      const zResults = searchCatalog("Z", fullCatalog, 50);
      assert.ok(zResults.length >= 10, `'Z' search should return at least 10 movies, got ${zResults.length}`);
    });

    test("searches and evaluates attributes (Director, Actor, Year, Genre, Language)", async () => {
      const attrRes = await invoke(router, { method: "GET", url: "/search?q=rajamouli" });
      assert.equal(attrRes.status, 200);
      assert.ok(
        attrRes.body.attributes.some(
          (a: any) => a.kind === "director" && a.value === "S. S. Rajamouli"
        ),
        "Expected Director: S. S. Rajamouli in attribute suggestions"
      );

      const baahubali = byTitle("Baahubali: The Beginning");
      const dirMatch = evaluateAttributeGuess("director", "S. S. Rajamouli", baahubali);
      assert.equal(dirMatch.matched, true);
      assert.equal(dirMatch.kind, "director");
      assert.equal(dirMatch.hintsPatch.director, "S. S. Rajamouli");

      const yearMatch = evaluateAttributeGuess("year", "2015", baahubali);
      assert.equal(yearMatch.matched, true);
      assert.equal(yearMatch.hintsPatch.year?.relation, "same");

      const postAttr = await invoke(router, {
        method: "POST",
        url: "/attribute",
        body: { kind: "year", value: String(target.year) },
      });
      assert.equal(postAttr.status, 200);
      assert.equal(postAttr.body.matched, true);
      assert.equal(postAttr.body.kind, "year");
    });

    test("distinguishes remakes by year", () => {
      const labels = searchCatalog("batman", movies).map((s) => s.label);
      assert.ok(labels.includes("Batman (1966)") && labels.includes("Batman (1989)"));
    });

    test("matches by alias (Bahubali spelling)", () => {
      const labels = searchCatalog("bahubali", movies).map((s) => s.title);
      assert.ok(labels.some((t) => t.startsWith("Baahubali")));
    });
  });

  describe("Strict guess resolution", () => {
    test("strict mode rejects fuzzy typos and arbitrary words", async () => {
      assert.equal((await service.evaluateGuess("jawz", getTodayUTC(), { strict: true })).recognized, false);
      assert.equal((await service.evaluateGuess("high", getTodayUTC(), { strict: true })).recognized, false);
    });

    test("strict mode accepts exact 'Title (Year)' labels from suggestions", async () => {
      const r = await service.evaluateGuess("Batman (1966)", getTodayUTC(), { strict: true });
      assert.equal(r.recognized, true);
      if (r.recognized) assert.equal(r.matchedTitle, "Batman (1966)");
    });

    test("POST /guess accepts the strict flag", async () => {
      const res = await invoke(router, {
        method: "POST",
        url: "/guess",
        body: { guess: "jawz", strict: true },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.recognized, false);
    });
  });

  describe("Give up", () => {
    test("POST /giveup reveals today's answer with details", async () => {
      const res = await invoke(router, { method: "POST", url: "/giveup" });
      assert.equal(res.status, 200);
      assert.equal(res.body.revealedAnswer.title, target.title);
      assert.equal(res.body.revealedAnswer.year, target.year);
      assert.equal(res.body.revealedAnswer.id, undefined);
      assert.equal(res.body.revealedAnswer.embedding, undefined);
    });

    test("POST /giveup returns 503 when the catalog is unavailable", async () => {
      const empty = createMovieGoblinRouter(new MovieGoblinService(new MockRepo([])));
      const res = await invoke(empty, { method: "POST", url: "/giveup" });
      assert.equal(res.status, 503);
    });
  });

  describe("Clues", () => {
    test("serves progressive clues 1..total and rejects out-of-range", async () => {
      const first = await invoke(router, { method: "GET", url: "/clue?n=1" });
      assert.equal(first.status, 200);
      assert.equal(first.body.n, 1);
      assert.ok(first.body.total >= 4);
      assert.equal(typeof first.body.text, "string");

      const last = await invoke(router, { method: "GET", url: `/clue?n=${first.body.total}` });
      assert.equal(last.status, 200);

      for (const bad of ["0", String(first.body.total + 1), "abc", ""]) {
        assert.equal((await invoke(router, { method: "GET", url: `/clue?n=${bad}` })).status, 400);
      }
    });

    test("early clues never contain the title; plot clue masks title words", () => {
      for (const movie of movies) {
        const ladder = buildClues(movie);
        const norm = (s: string) => s.toLowerCase();
        for (const clue of ladder.filter((c) => c.label !== "Release year")) {
          if (movie.title.length >= 5) {
            assert.ok(
              !norm(clue.text).includes(norm(movie.title)),
              `Clue "${clue.label}" leaks the title of ${movie.title}`
            );
          }
        }
      }
      const masked = maskPlot("Jaws terrorizes Amity Island in 1975.", byTitle("Jaws"));
      assert.ok(!/jaws/i.test(masked) && !masked.includes("1975"));
    });

    test("director clue gives initials only", () => {
      const clue = buildClues(byTitle("Fight Club")).find((c) => c.label === "Director");
      assert.ok(clue);
      assert.ok(clue!.text.includes("D. F."));
      assert.ok(!clue!.text.includes("Fincher"));
    });
  });

  describe("Hints (badges)", () => {
    test("same director is flagged; different director is not", () => {
      const hints = buildGuessHints(byTitle("Interstellar"), byTitle("Inception"));
      assert.equal(hints.director, "Christopher Nolan");
      assert.equal(buildGuessHints(byTitle("Jaws"), byTitle("Inception")).director, undefined);
    });

    test("shared cast and shared genres are reported", () => {
      const hints = buildGuessHints(byTitle("The Godfather: Part II"), byTitle("The Godfather"));
      assert.ok(hints.cast.includes("Al Pacino"));
      assert.ok(hints.genres.includes("Crime"));
      assert.equal(hints.language, "English");
    });

    test("year relation points toward the target film", () => {
      const early = buildGuessHints(byTitle("Jaws"), byTitle("Inception")); // 1975 vs 2010
      assert.equal(early.year.relation, "later");
      const late = buildGuessHints(byTitle("Inception"), byTitle("Jaws"));
      assert.equal(late.year.relation, "earlier");
      const same = buildGuessHints(byTitle("Pulp Fiction"), byTitle("The Lion King"));
      assert.equal(same.year.relation, "same");
      assert.equal(same.year.decadeMatch, true);
    });

    test("POST /guess returns hints and never exposes undisclosed fields", async () => {
      const other = movies.find((m) => m.id !== target.id)!;
      const res = await invoke(router, {
        method: "POST",
        url: "/guess",
        body: { guess: `${other.title} (${other.year})`, strict: true },
      });
      assert.equal(res.body.recognized, true);
      assert.ok(res.body.hints);
      assert.equal(res.body.hints.year.value, other.year);
      assert.equal(res.body.revealedAnswer, undefined);
      assert.equal(res.body.hints.title, undefined);
    });

    test("correct guess reveals the full answer details", async () => {
      const res = await invoke(router, {
        method: "POST",
        url: "/guess",
        body: { guess: `${target.title} (${target.year})`, strict: true },
      });
      assert.equal(res.body.isCorrect, true);
      assert.equal(res.body.similarity, 100);
      assert.equal(res.body.revealedAnswer.title, target.title);
      assert.equal(res.body.hints.year.relation, "same");
    });
  });

  describe("Calibrated match percent", () => {
    test("is an integer 0-99 for wrong films and ranks related films above unrelated ones", () => {
      const t = byTitle("The Godfather");
      const pct = (g: CatalogMovie) => computeMatchPercent(g, t, cosineSimilarity(g.embedding, t.embedding));

      const sequel = pct(byTitle("The Godfather: Part II"));
      const crime = pct(byTitle("Pulp Fiction"));
      const unrelated = pct(byTitle("Toy Story"));

      for (const v of [sequel, crime, unrelated]) {
        assert.ok(Number.isInteger(v) && v >= 0 && v <= 99);
      }
      assert.ok(sequel > crime, `sequel ${sequel} should beat crime ${crime}`);
      assert.ok(crime > unrelated, `crime ${crime} should beat unrelated ${unrelated}`);
      assert.ok(sequel >= 85, `sequel should score very high, got ${sequel}`);
      assert.ok(unrelated <= 35, `unrelated should score low, got ${unrelated}`);
    });

    test("same-director films score above comparable films by other directors", () => {
      const t = byTitle("Inception");
      const pct = (g: CatalogMovie) => computeMatchPercent(g, t, cosineSimilarity(g.embedding, t.embedding));
      assert.ok(pct(byTitle("Interstellar")) > pct(byTitle("Jurassic Park")));
    });

    test("Gladiator and CSV films produce accurate multi-aspect match percentages across all movie types", () => {
      const fullCatalog = mergeCatalogWithCombinedCsv(movies);
      const gladiator = byTitle("Gladiator");
      const baahubali1 = byTitle("Baahubali: The Beginning");
      const baahubali2 = byTitle("Baahubali 2: The Conclusion");
      const darkKnight = byTitle("The Dark Knight");
      const clueless = byTitle("Clueless");
      const toyStory = byTitle("Toy Story");

      const scoreAgainst = (g: CatalogMovie, t: CatalogMovie) =>
        computeMatchPercent(g, t, cosineSimilarity(g.embedding, t.embedding));

      // Sequels score very high (>= 85%)
      const b1_b2 = scoreAgainst(baahubali1, baahubali2);
      assert.ok(b1_b2 >= 85, `Baahubali 1 vs 2 should be >= 85%, got ${b1_b2}%`);

      // Gladiator vs epic action/revenge films (Baahubali, Dark Knight) scores much higher than vs Clueless or Toy Story
      const glad_dk = scoreAgainst(gladiator, darkKnight);
      const glad_baa = scoreAgainst(gladiator, baahubali1);
      const glad_clue = scoreAgainst(gladiator, clueless);
      const glad_toy = scoreAgainst(gladiator, toyStory);

      assert.ok(glad_dk > glad_clue, `Gladiator vs Dark Knight (${glad_dk}%) should beat Clueless (${glad_clue}%)`);
      assert.ok(glad_baa > glad_toy, `Gladiator vs Baahubali (${glad_baa}%) should beat Toy Story (${glad_toy}%)`);

      // CSV movies (e.g. Troy / Braveheart) vs Gladiator also score higher than unrelated CSV movies
      const troy = fullCatalog.find((m) => m.title === "Troy");
      if (troy) {
        const glad_troy = scoreAgainst(troy, gladiator);
        assert.ok(
          glad_troy > glad_toy,
          `Troy (CSV) vs Gladiator (${glad_troy}%) should beat Toy Story (${glad_toy}%)`
        );
      }
    });
  });
});
