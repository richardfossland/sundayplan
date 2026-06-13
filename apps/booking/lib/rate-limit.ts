/**
 * Minimal in-memory fixed-window rate limiter for the UNAUTHENTICATED public
 * endpoints (rental POST). It throttles abuse — mass pending bookings, slug
 * enumeration — by counting hits per key (e.g. `ip:slug`) inside a rolling
 * window.
 *
 * SCOPE / PROD UPGRADE: this is process-local. On a single Worker/Node instance
 * it works; across a horizontally-scaled or serverless-per-request deployment
 * each instance keeps its own counter, so the effective limit is (limit ×
 * instances) and a cold start resets it. That is acceptable as a FIRST line of
 * defence against trivial scripted abuse, but the durable production upgrade is
 * a shared store (Cloudflare KV / Durable Object / Upstash Redis) keyed the same
 * way. Kept dependency-free + edge-safe so it works in both runtimes today.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  /** Remaining hits in the current window (>= 0). */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Max hits allowed per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Account one hit for `key`. Returns ok:false once the limit is exceeded inside
 * the window. Opportunistically evicts a handful of expired buckets so the map
 * doesn't grow unbounded under enumeration (each distinct ip/slug is a key).
 */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = opts.now ?? Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    buckets.set(key, { count: 1, resetAt });
    sweep(now);
    return { ok: true, remaining: opts.limit - 1, resetAt };
  }

  existing.count += 1;
  const remaining = opts.limit - existing.count;
  return { ok: remaining >= 0, remaining: Math.max(0, remaining), resetAt: existing.resetAt };
}

/** Test-only: clear all buckets. */
export function __resetRateLimit(): void {
  buckets.clear();
}

let lastSweep = 0;
function sweep(now: number): void {
  // Cheap amortized GC: at most once per 30s, drop expired buckets.
  if (now - lastSweep < 30_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Best-effort client IP from common proxy headers. Cloudflare sets
 * `cf-connecting-ip`; standard proxies set `x-forwarded-for` (first hop). Falls
 * back to a constant so a missing header degrades to a per-route (not per-IP)
 * limit rather than disabling the guard.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
