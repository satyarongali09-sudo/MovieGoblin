import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  MovieGoblinService,
  CatalogUnavailableError,
} from "../services/moviegoblin.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";

const guessSchema = z.object({
  guess: z
    .string()
    .trim()
    .min(1, "Guess cannot be empty.")
    .max(100, "Guess cannot exceed 100 characters."),
  /** When true, only exact catalog titles/aliases match (no fuzzy typo matching). */
  strict: z.boolean().optional(),
});

const attributeSchema = z.object({
  kind: z.enum(["director", "actor", "year", "genre", "language"]),
  value: z.string().trim().min(1).max(100),
});

/** Reads a query parameter without relying on Express's parsed `req.query`. */
function readQueryParam(req: Request, name: string): string {
  const fromParsed = (req.query as Record<string, unknown> | undefined)?.[name];
  if (typeof fromParsed === "string") return fromParsed;
  try {
    return new URL(req.originalUrl || req.url || "", "http://localhost").searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

// Rate limiters: 60/min for GET daily, 30/min for POST guess
const dailyRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many requests for daily puzzle. Please slow down.",
});

const guessRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many guesses submitted. Please wait a moment before trying again.",
});

const searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 240,
  message: "Too many searches. Please slow down.",
});

const clueRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many clue requests. Please slow down.",
});

const giveUpRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many give-up requests. Please slow down.",
});

export function createMovieGoblinRouter(
  service: MovieGoblinService = new MovieGoblinService()
): Router {
  const router = Router();

  /**
   * GET /moviegoblin/daily
   * Returns current UTC puzzle date and game limits.
   * Never leaks target movie ID, title, plot, or embedding.
   */
  router.get(
    "/daily",
    dailyRateLimiter,
    asyncHandler(async (_req: Request, res: Response) => {
      try {
        const info = await service.getDailyPuzzle();
        res.json(info);
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          res.status(503).json({
            error: "Daily puzzle is currently unavailable. Movie catalog is empty or unreachable.",
          });
          return;
        }
        throw err;
      }
    })
  );

  /**
   * POST /moviegoblin/guess
   * Evaluates a player's movie title guess against today's hidden puzzle.
   */
  router.post(
    "/guess",
    guessRateLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = guessSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || "Invalid guess payload.",
        });
        return;
      }

      try {
        const result = await service.evaluateGuess(parsed.data.guess, undefined, {
          strict: parsed.data.strict,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          res.status(503).json({
            error: "Evaluation service is currently unavailable. Movie catalog is empty or unreachable.",
          });
          return;
        }
        throw err;
      }
    })
  );

  /**
   * GET /moviegoblin/search?q=...
   * Catalog-only autocomplete across movies (starting from 1 character) plus attributes.
   */
  router.get(
    "/search",
    searchRateLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const q = readQueryParam(req, "q").slice(0, 100);
      try {
        const [results, attributes] = await Promise.all([
          service.searchMovies(q, 40),
          service.searchCatalogAttributes(q, 8),
        ]);
        res.json({ results, attributes });
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          res.status(503).json({ error: "Movie search is currently unavailable." });
          return;
        }
        throw err;
      }
    })
  );

  /**
   * POST /moviegoblin/attribute
   * Checks whether a player-selected Director, Actor, Year, Genre, or Language matches today's film.
   */
  router.post(
    "/attribute",
    guessRateLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = attributeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || "Invalid attribute payload.",
        });
        return;
      }
      try {
        const result = await service.evaluateAttribute(parsed.data.kind, parsed.data.value);
        res.json(result);
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          res.status(503).json({ error: "Attribute check is currently unavailable." });
          return;
        }
        throw err;
      }
    })
  );

  /**
   * GET /moviegoblin/clue?n=1
   * Returns the n-th progressive clue for today's film (vague to specific).
   */
  router.get(
    "/clue",
    clueRateLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const n = parseInt(readQueryParam(req, "n"), 10);
      try {
        const clue = await service.getClue(n);
        if (!clue) {
          res.status(400).json({ error: "No such clue." });
          return;
        }
        res.json(clue);
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          res.status(503).json({ error: "Clues are currently unavailable." });
          return;
        }
        throw err;
      }
    })
  );

  /**
   * POST /moviegoblin/giveup
   * Reveals today's answer (title, year, director, cast, ...) after the player gives up.
   */
  router.post(
    "/giveup",
    giveUpRateLimiter,
    asyncHandler(async (_req: Request, res: Response) => {
      try {
        res.json(await service.giveUp());
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          res.status(503).json({ error: "The answer is currently unavailable." });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}

export default createMovieGoblinRouter();
