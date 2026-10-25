import type { Request, Response, NextFunction } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
};

type ClientRecord = {
  count: number;
  resetAt: number;
};

/**
 * Lightweight in-memory sliding rate limiter.
 * Does not require external services or Redis.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, message = "Too many requests. Please slow down." } = options;
  const hits = new Map<string, ClientRecord>();

  // Periodically clean up expired entries every 5 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now >= record.resetAt) {
        hits.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  if (typeof cleanupInterval.unref === "function") {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || "anonymous";

    const record = hits.get(ip);

    if (!record || now >= record.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count += 1;

    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}
