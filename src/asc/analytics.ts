import { gunzipSync } from "node:zlib";
import { ascGetJson, ascPostJson } from "./client.js";
import { retryFetch } from "../utils/retry.js";
import type { AscListResponse, AscResource } from "./types.js";

/**
 * App Store Analytics Reports API.
 *
 * This is the ASYNC report pipeline (distinct from the Sales/Trends salesReports
 * endpoint used elsewhere in this server). The flow is 5 stages:
 *
 *   1. Create (or reuse) an analyticsReportRequest for an app.
 *      Access type is ONGOING (recurring daily/weekly/monthly) or
 *      ONE_TIME_SNAPSHOT (full historical dump). ONGOING data appears
 *      ~24-48h after the request is created.
 *
 *   2. Inside a request, list the reports Apple offers (grouped by category
 *      like APP_STORE_ENGAGEMENT or APP_USAGE). Each report is a schema —
 *      e.g. "App Store Discovery and Engagement".
 *
 *   3. Inside a report, list instances. Each instance corresponds to one
 *      processing date at one granularity (DAILY / WEEKLY / MONTHLY).
 *
 *   4. Inside an instance, list segments. Big reports are chunked; each
 *      segment is a gzipped TSV file with a short-lived pre-signed S3 URL.
 *
 *   5. Download every segment URL, gunzip, concatenate. That is the data.
 *
 * Gotchas:
 *   - The pre-signed S3 URL must be fetched WITHOUT the ASC Bearer token —
 *     the pre-sign already embeds credentials and S3 rejects extra auth.
 *   - Report requests can end up in `stoppedDueToInactivity=true` if nothing
 *     pulls from them for a while; in that state Apple won't publish new
 *     instances. Callers need to create a fresh one.
 *   - Creating a report request for a category for the first time requires
 *     the Admin role. Once created, keys with Sales and Reports or Finance
 *     can list and download.
 */

export type AnalyticsAccessType = "ONE_TIME_SNAPSHOT" | "ONGOING";

export type AnalyticsReportCategory =
  | "APP_USAGE"
  | "APP_STORE_ENGAGEMENT"
  | "COMMERCE"
  | "FRAMEWORKS_USAGE"
  | "PERFORMANCE";

export type AnalyticsGranularity = "DAILY" | "WEEKLY" | "MONTHLY";

// ---------------------------------------------------------------------------
// Response type shapes
// ---------------------------------------------------------------------------

export type AnalyticsReportRequestAttrs = {
  accessType?: AnalyticsAccessType;
  stoppedDueToInactivity?: boolean;
};

export type AnalyticsReportAttrs = {
  name?: string;
  category?: AnalyticsReportCategory;
};

export type AnalyticsReportInstanceAttrs = {
  granularity?: AnalyticsGranularity;
  processingDate?: string;
};

export type AnalyticsReportSegmentAttrs = {
  checksum?: string;
  url?: string;
  sizeInBytes?: number;
};

// ---------------------------------------------------------------------------
// Stage 1 — report requests
// ---------------------------------------------------------------------------

/**
 * Lists analytics report requests for a specific app, filtered by access type.
 * Apple caps the response at 200 requests; in practice a single app has 1-2.
 */
export async function listAnalyticsReportRequests(
  appId: string,
  accessType?: AnalyticsAccessType
): Promise<AscResource<AnalyticsReportRequestAttrs>[]> {
  const qs = new URLSearchParams();
  qs.set("limit", "200");
  qs.set(
    "fields[analyticsReportRequests]",
    "accessType,stoppedDueToInactivity"
  );
  if (accessType) qs.set("filter[accessType]", accessType);
  const path = `/v1/apps/${encodeURIComponent(appId)}/analyticsReportRequests?${qs.toString()}`;
  const resp = await ascGetJson<AscListResponse<AnalyticsReportRequestAttrs>>(path);
  return resp.data;
}

/**
 * Creates a new analytics report request. Apple returns 201 on success.
 *
 * First-time creation for an app requires the Admin role — a Sales and
 * Reports / Finance key will get a 403. We surface that hint verbatim.
 */
export async function createAnalyticsReportRequest(
  appId: string,
  accessType: AnalyticsAccessType
): Promise<AscResource<AnalyticsReportRequestAttrs>> {
  type CreateResp = { data: AscResource<AnalyticsReportRequestAttrs> };
  const body = {
    data: {
      type: "analyticsReportRequests",
      attributes: { accessType },
      relationships: {
        app: { data: { type: "apps", id: appId } },
      },
    },
  };
  try {
    const resp = await ascPostJson<typeof body, CreateResp>(
      "/v1/analyticsReportRequests",
      body
    );
    return resp.data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403")) {
      throw new Error(
        `403 creating analyticsReportRequest — Apple requires the Admin role ` +
          `to create a report request for the first time on an app. ` +
          `Either use an Admin API key, or ask an admin to create the request ` +
          `once (afterwards Sales-and-Reports / Finance keys can read from it). ` +
          `Original error: ${msg}`
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — reports inside a request
// ---------------------------------------------------------------------------

/**
 * Lists the report schemas available inside a given request.
 *
 * We drop pagination — the total count is small (dozens per category)
 * so a single 200-limit fetch always covers it in practice.
 */
export async function listAnalyticsReports(
  requestId: string,
  category?: AnalyticsReportCategory,
  name?: string
): Promise<AscResource<AnalyticsReportAttrs>[]> {
  const qs = new URLSearchParams();
  qs.set("limit", "200");
  qs.set("fields[analyticsReports]", "name,category");
  if (category) qs.set("filter[category]", category);
  if (name) qs.set("filter[name]", name);
  const path = `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?${qs.toString()}`;
  const resp = await ascGetJson<AscListResponse<AnalyticsReportAttrs>>(path);
  return resp.data;
}

// ---------------------------------------------------------------------------
// Stage 3 — instances inside a report
// ---------------------------------------------------------------------------

/**
 * Lists instances (a single processingDate × granularity) inside a report.
 * Filter by granularity to avoid mixing daily/weekly/monthly rows.
 */
export async function listAnalyticsReportInstances(
  reportId: string,
  opts: {
    granularity?: AnalyticsGranularity;
    processingDate?: string;
    limit?: number;
  } = {}
): Promise<AscResource<AnalyticsReportInstanceAttrs>[]> {
  const qs = new URLSearchParams();
  qs.set("limit", String(opts.limit ?? 200));
  qs.set("fields[analyticsReportInstances]", "granularity,processingDate");
  if (opts.granularity) qs.set("filter[granularity]", opts.granularity);
  if (opts.processingDate) qs.set("filter[processingDate]", opts.processingDate);
  const path = `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances?${qs.toString()}`;
  const resp = await ascGetJson<AscListResponse<AnalyticsReportInstanceAttrs>>(path);
  return resp.data;
}

// ---------------------------------------------------------------------------
// Stage 4 — segments inside an instance
// ---------------------------------------------------------------------------

export async function listAnalyticsReportSegments(
  instanceId: string
): Promise<AscResource<AnalyticsReportSegmentAttrs>[]> {
  const qs = new URLSearchParams();
  qs.set("limit", "200");
  qs.set("fields[analyticsReportSegments]", "url,checksum,sizeInBytes");
  const path = `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments?${qs.toString()}`;
  const resp = await ascGetJson<AscListResponse<AnalyticsReportSegmentAttrs>>(path);
  return resp.data;
}

// ---------------------------------------------------------------------------
// Stage 5 — download a segment
// ---------------------------------------------------------------------------

/**
 * Fetches a segment's pre-signed S3 URL and returns the decoded TSV text.
 *
 * Critical: the URL is already signed by Apple. Sending an Authorization
 * header would flip S3 into "check both credentials" mode and 400.
 * We use the raw retryFetch helper without touching auth.ts.
 */
export async function fetchSegmentTsv(url: string): Promise<string> {
  const res = await retryFetch(() => fetch(url));
  if (!res.ok) {
    // Body is XML from S3 on errors; take a preview.
    const preview = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `Segment download ${res.status} ${res.statusText}: ${preview.slice(0, 300)}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Segment payloads are always gzipped per Apple's spec. If a mock/proxy
  // ever returns plain text we still try to gunzip; on failure fall back.
  try {
    return gunzipSync(buf).toString("utf-8");
  } catch {
    return buf.toString("utf-8");
  }
}

/**
 * Downloads every segment of an instance in parallel and returns the
 * concatenated TSV text (with duplicate header rows stripped).
 *
 * We cap concurrency at 4 — Apple's fronting CDN throttles hard beyond that
 * on the pre-signed URLs, same threshold we already use for sales reports.
 */
export async function downloadAllSegments(
  instanceId: string
): Promise<{ segmentCount: number; tsv: string; bytes: number }> {
  const segments = await listAnalyticsReportSegments(instanceId);
  const urls = segments
    .map((s) => s.attributes?.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (urls.length === 0) {
    return { segmentCount: 0, tsv: "", bytes: 0 };
  }

  const concurrency = Math.min(4, urls.length);
  const results: Array<{ idx: number; tsv: string }> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const idx = cursor++;
      const url = urls[idx]!;
      const tsv = await fetchSegmentTsv(url);
      results.push({ idx, tsv });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Keep original order (segments are sometimes ordered by date range).
  results.sort((a, b) => a.idx - b.idx);

  // Strip duplicated header rows from segments 2..N — Apple repeats the
  // header line in every chunk, and a naive concat would poison parseTsv.
  let combined = "";
  let firstHeader: string | null = null;
  let bytes = 0;
  for (const { tsv } of results) {
    bytes += Buffer.byteLength(tsv, "utf-8");
    if (tsv.length === 0) continue;
    const nlIdx = tsv.indexOf("\n");
    const header = nlIdx >= 0 ? tsv.slice(0, nlIdx) : tsv;
    if (firstHeader === null) {
      firstHeader = header;
      combined = tsv;
    } else if (header === firstHeader && nlIdx >= 0) {
      combined += "\n" + tsv.slice(nlIdx + 1);
    } else {
      // Header mismatch — different schema than segment 1. Concatenate
      // as-is and let the caller notice via parseTsv output.
      combined += "\n" + tsv;
    }
  }

  return { segmentCount: urls.length, tsv: combined, bytes };
}

// ---------------------------------------------------------------------------
// High-level: find the "engagement" report for an app
// ---------------------------------------------------------------------------

/**
 * Locates the primary App Store Engagement report for an app.
 *
 * Apple ships multiple reports under APP_STORE_ENGAGEMENT — the "standard"
 * one aggregates by Territory × Source × Event, the "Detailed" adds source
 * subtype and page. We prefer the standard variant because it's an order of
 * magnitude smaller (rows and download size) and covers the geo/source
 * funnel breakdown we care about.
 *
 * If no ONGOING request exists yet, we surface that as a null result so the
 * caller can either fall back to ONE_TIME_SNAPSHOT or prompt to create one.
 */
export async function findEngagementReport(
  appId: string,
  opts: { preferDetailed?: boolean } = {}
): Promise<{
  requestId: string;
  reportId: string;
  reportName: string;
  accessType: AnalyticsAccessType;
} | null> {
  const requests = await listAnalyticsReportRequests(appId);
  // Prefer ONGOING that's still active — data is fresh daily and doesn't
  // require re-creation. Fall back to ONE_TIME_SNAPSHOT (historical).
  const ongoing = requests.find(
    (r) =>
      r.attributes?.accessType === "ONGOING" &&
      !r.attributes?.stoppedDueToInactivity
  );
  const snapshot = requests.find(
    (r) =>
      r.attributes?.accessType === "ONE_TIME_SNAPSHOT" &&
      !r.attributes?.stoppedDueToInactivity
  );
  const request = ongoing ?? snapshot;
  if (!request) return null;

  const reports = await listAnalyticsReports(request.id, "APP_STORE_ENGAGEMENT");
  // Match tolerant to Apple's naming drift ("App Store Discovery and
  // Engagement", "... Standard", etc). Detailed variant contains "Detailed".
  const detailed = reports.find((r) => /detailed/i.test(r.attributes?.name ?? ""));
  const standard = reports.find(
    (r) =>
      /engagement/i.test(r.attributes?.name ?? "") &&
      !/detailed/i.test(r.attributes?.name ?? "")
  );
  const picked = opts.preferDetailed ? detailed ?? standard : standard ?? detailed;
  if (!picked) return null;

  return {
    requestId: request.id,
    reportId: picked.id,
    reportName: picked.attributes?.name ?? "unknown",
    accessType: request.attributes?.accessType ?? "ONGOING",
  };
}
