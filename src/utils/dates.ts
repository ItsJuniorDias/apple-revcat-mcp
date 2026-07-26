/**
 * Date helpers for Apple's sales reports.
 *
 * Apple aggregates daily reports on a fixed timezone (America/Los_Angeles for
 * SALES/SUBSCRIPTION reports) and publishes them with ~24h lag. Asking for
 * "today" almost always returns 404, so we default to "yesterday in LA time".
 */

const APPLE_TZ = "America/Los_Angeles";

/** Returns YYYY-MM-DD for the given Date in Apple's report timezone. */
export function formatAppleDate(d: Date): string {
  // Intl gives us the parts in the requested timezone without touching the Date.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APPLE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/**
 * Returns the report date to request when the caller says "yesterday" or
 * doesn't specify. Uses Apple's timezone, so we don't ask for a day that
 * doesn't exist yet from Apple's perspective.
 */
export function appleYesterday(): string {
  const now = new Date();
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return formatAppleDate(y);
}

/** Returns YYYY-MM-DD for N days before today (Apple timezone). */
export function appleDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return formatAppleDate(d);
}

/**
 * Expands a start/end range (inclusive) into YYYY-MM-DD strings.
 *
 * We do NOT round-trip through Apple's timezone here — the caller has already
 * committed to specific calendar dates and expects those back verbatim.
 * Converting to LA-time would shift the whole range by a day and produce
 * "off by one" bugs downstream.
 */
export function daysInRange(startDate: string, endDate: string): string[] {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (end < start) {
    throw new Error(`endDate (${endDate}) is before startDate (${startDate})`);
  }
  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(formatUtcYmd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date, expected YYYY-MM-DD: ${s}`);
  const yr = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  // UTC midnight so range math doesn't wobble across DST boundaries.
  return new Date(Date.UTC(yr, mo - 1, da));
}

function formatUtcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isValidYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
