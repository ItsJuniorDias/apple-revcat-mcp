/**
 * Small TSV utilities for Apple sales / subscription reports.
 *
 * Apple returns gzipped TSV with a header row and one row per SKU × territory
 * (for daily SUMMARY reports). Rows are terminated by \n, fields by \t.
 * We do NOT do CSV-style quoting: Apple's TSV has no embedded tabs or quotes.
 */

export type TsvRow = Record<string, string>;

export function parseTsv(text: string): TsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = (lines[0] ?? "").split("\t");
  const rows: TsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? "").split("\t");
    const row: TsvRow = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j] ?? `col_${j}`] = cols[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Truncates TSV text by line count while preserving the header and reporting
 * how much was dropped. Callers see something they can still parse instead of
 * a header + half a row.
 */
export function truncateTsv(text: string, maxLines: number = 400): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines);
  const dropped = lines.length - maxLines;
  return `${kept.join("\n")}\n... [truncated, ${dropped} more lines. Total=${lines.length}]`;
}

/**
 * Groups TSV rows by a key function, summing numeric columns.
 * Missing / non-numeric values are treated as 0.
 */
export function groupSum<K extends string>(
  rows: TsvRow[],
  keyFn: (r: TsvRow) => string,
  numericCols: readonly K[]
): Array<{ key: string; count: number; sums: Record<K, number> }> {
  const bucket = new Map<string, { count: number; sums: Record<K, number> }>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!bucket.has(key)) {
      const sums = Object.fromEntries(numericCols.map((c) => [c, 0])) as Record<K, number>;
      bucket.set(key, { count: 0, sums });
    }
    const entry = bucket.get(key)!;
    entry.count += 1;
    for (const col of numericCols) {
      const v = Number(row[col] ?? 0);
      if (Number.isFinite(v)) entry.sums[col] = (entry.sums[col] ?? 0) + v;
    }
  }
  return [...bucket.entries()].map(([key, { count, sums }]) => ({ key, count, sums }));
}
