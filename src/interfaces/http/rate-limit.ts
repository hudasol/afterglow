/**
 * Small in memory limits for /api, so one script cannot exhaust the shared Qloo allowance. Both
 * use fixed windows per client address. They keep no state across restarts and are not meant for
 * more than one process.
 */
import type { NextFunction, Request, Response } from 'express';

const MINUTE_MS = 60_000;
const PRUNE_ABOVE = 10_000;

export interface WindowLimiterOptions {
  /** Units allowed per client in one window. 0 turns the limit off. */
  limit: number;
  windowMs: number;
  /** Use the last X-Forwarded-For entry. Only correct behind exactly one trusted proxy. */
  trustProxy: boolean;
  now?: () => number;
}

export interface TakeResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function clientKey(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const last = list.at(-1);
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Counts units against one client address in a fixed window. */
export function windowLimiter(options: WindowLimiterOptions): {
  take: (req: Request) => TakeResult;
} {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(req) {
      if (options.limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
      const t = now();
      const key = clientKey(req, options.trustProxy);
      let window = windows.get(key);
      if (!window || t - window.start >= options.windowMs) {
        window = { start: t, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      if (windows.size > PRUNE_ABOVE) {
        for (const [k, w] of windows) if (t - w.start >= options.windowMs) windows.delete(k);
      }
      return {
        allowed: window.count <= options.limit,
        retryAfterSeconds: Math.max(1, Math.ceil((window.start + options.windowMs - t) / 1000)),
      };
    },
  };
}

export interface RateLimitOptions {
  /** Requests allowed per client per minute. 0 turns the limit off. */
  perMinute: number;
  trustProxy: boolean;
  now?: () => number;
}

export function rateLimit(options: RateLimitOptions) {
  const limiter = windowLimiter({
    limit: options.perMinute,
    windowMs: MINUTE_MS,
    trustProxy: options.trustProxy,
    ...(options.now ? { now: options.now } : {}),
  });
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = limiter.take(req);
    if (!result.allowed) {
      res
        .status(429)
        .set('Retry-After', String(result.retryAfterSeconds))
        .json({
          error: {
            code: 'rate_limited',
            message: 'Too many requests from this address. Wait a minute and try again.',
          },
        });
      return;
    }
    next();
  };
}
