import { gunzipSync } from "node:zlib";
import { getAscToken } from "./auth.js";
import { retryFetch } from "../utils/retry.js";
import type { SalesReportParams } from "./types.js";

const BASE = "https://api.appstoreconnect.apple.com";

/**
 * Low-level fetch: adds Bearer token, retries transient failures, returns
 * the raw Response so callers can decide how to decode (JSON, gzipped TSV,
 * or a redirect URL).
 */
async function ascFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAscToken();
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  return retryFetch(() =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    })
  );
}

async function bodyPreview(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

/**
 * Throws a helpful error on non-2xx, otherwise returns the parsed JSON body.
 * Error messages include a small body preview so 401s and 404s are diagnosable
 * without opening a proxy.
 */
export async function ascGetJson<T>(path: string): Promise<T> {
  const res = await ascFetch(path);
  if (!res.ok) {
    const body = await bodyPreview(res);
    throw new Error(`ASC ${res.status} ${res.statusText} on ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function ascPostJson<TBody, TResp>(
  path: string,
  body: TBody
): Promise<TResp> {
  const res = await ascFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const preview = await bodyPreview(res);
    throw new Error(`ASC POST ${res.status} on ${path}: ${preview}`);
  }
  return (await res.json()) as TResp;
}

/**
 * Fetches a sales / subscription report. Apple returns a gzipped TSV; we
 * unzip inline and return the decoded text so the model can inspect it or so
 * downstream helpers (parseTsv, groupSum) can aggregate it.
 */
export async function ascGetSalesReport(params: SalesReportParams): Promise<string> {
  const qs = new URLSearchParams({
    "filter[vendorNumber]": params.vendorNumber,
    "filter[reportType]": params.reportType,
    "filter[reportSubType]": params.reportSubType,
    "filter[frequency]": params.frequency,
    "filter[reportDate]": params.reportDate,
  });
  if (params.version) qs.set("filter[version]", params.version);

  const res = await ascFetch(`/v1/salesReports?${qs.toString()}`);
  if (!res.ok) {
    const body = await bodyPreview(res);
    // 404 usually means "report not published yet for this date". Include the
    // exact date so the model knows to retry with an earlier one.
    throw new Error(
      `ASC salesReports ${res.status} (reportType=${params.reportType}, ` +
        `date=${params.reportDate}): ${body}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return gunzipSync(buf).toString("utf-8");
}
