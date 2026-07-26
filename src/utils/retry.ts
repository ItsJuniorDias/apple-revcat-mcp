/**
 * Retry helpers for flaky upstream APIs (Apple / RevenueCat).
 *
 * Both APIs occasionally return:
 *   - 429 Too Many Requests (rate limit)
 *   - 5xx transient errors
 *   - Network-level failures (ECONNRESET, socket hang up, fetch failed)
 *
 * We retry only these, never 4xx errors that indicate a real client mistake
 * (bad JWT, wrong vendor number, malformed date, etc). Those should surface
 * immediately so the model gets a clear signal.
 */

export type RetryOptions = {
  /** Max attempts including the first one. Default 4. */
  maxAttempts?: number;
  /** Base delay in ms for the first retry. Default 500ms. */
  baseDelayMs?: number;
  /** Cap on delay between attempts. Default 8000ms. */
  maxDelayMs?: number;
};

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string }; name?: string };
  if (e.code && NETWORK_ERROR_CODES.has(e.code)) return true;
  if (e.cause?.code && NETWORK_ERROR_CODES.has(e.cause.code)) return true;
  // Undici / native fetch wraps DNS/connect failures in a TypeError
  if (e.name === "TypeError") return true;
  return false;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  // Full jitter — spreads concurrent retries
  return Math.floor(Math.random() * exp);
}

/**
 * Runs `fn` with retry+backoff for network errors and retryable HTTP responses.
 * If `fn` returns a Response, we peek at its status. On retryable status, we
 * drain the body and retry. On success or non-retryable status, we return.
 */
export async function retryFetch(
  fn: () => Promise<Response>,
  opts: RetryOptions = {}
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fn();
      if (res.ok || !isRetryableStatus(res.status) || attempt === maxAttempts) {
        return res;
      }
      // Respect Retry-After when the upstream tells us how long to wait
      const retryAfter = res.headers.get("retry-after");
      const hintMs = retryAfter ? parseRetryAfter(retryAfter) : null;
      // Drain body so the connection can be reused
      await res.arrayBuffer().catch(() => undefined);
      const delay = hintMs ?? backoffDelay(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === maxAttempts) throw err;
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }

  // Only reached if maxAttempts === 0 (defensive).
  throw lastErr ?? new Error("retryFetch: exhausted attempts");
}

function parseRetryAfter(raw: string): number | null {
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(asSeconds * 1000, 30_000);
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.min(asDate - Date.now(), 30_000));
  }
  return null;
}
