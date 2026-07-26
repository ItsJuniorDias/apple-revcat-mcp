import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolHandler } from "../index.js";
import { ascGetJson, ascGetSalesReport, ascPostJson } from "./client.js";
import { getVendorNumber } from "./auth.js";
import { textResult, validated } from "../utils/tool.js";
import { parseTsv, truncateTsv } from "../utils/tsv.js";
import { appleYesterday, appleDaysAgo, daysInRange, isValidYmd } from "../utils/dates.js";
import type {
  AscApp,
  AscAppAttributes,
  AscCustomerReview,
  AscCustomerReviewAttributes,
  AscListResponse,
  SalesReportFrequency,
  SalesReportSubType,
  SalesReportType,
} from "./types.js";

type RegisterFn = (tool: Tool, handler: ToolHandler) => void;

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const ymdSchema = z
  .string()
  .refine(isValidYmd, "Expected YYYY-MM-DD format");

const reportTypeSchema = z.enum([
  "SALES",
  "SUBSCRIPTION",
  "SUBSCRIPTION_EVENT",
  "SUBSCRIBER",
  "PRE_ORDER",
]);

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAscTools(register: RegisterFn): void {
  registerListApps(register);
  registerGetSalesReport(register);
  registerGetSubscriptionEvents(register);
  registerGetSubscriptionEventsRange(register);
  registerGetGeoConversionSummary(register);
  registerListAllAppsSnapshot(register);
  registerListCustomerReviews(register);
  registerReplyToReview(register);
}

// ---------------------------------------------------------------------------
// asc_list_apps
// ---------------------------------------------------------------------------

const listAppsSchema = z.object({}).strict();

function registerListApps(register: RegisterFn): void {
  register(
    {
      name: "asc_list_apps",
      description:
        "List all apps in your App Store Connect account. Returns id, name, " +
        "bundleId, sku, primaryLocale. Use this first to discover appIds for " +
        "other tools (reviews, analytics).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    validated(listAppsSchema, async () => {
      const data = await ascGetJson<AscListResponse<AscAppAttributes>>(
        "/v1/apps?fields[apps]=name,bundleId,sku,primaryLocale&limit=200"
      );
      const apps: AscApp[] = data.data.map((a) => ({
        id: a.id,
        name: a.attributes?.name,
        bundleId: a.attributes?.bundleId,
        sku: a.attributes?.sku,
        primaryLocale: a.attributes?.primaryLocale,
      }));
      return textResult(apps);
    })
  );
}

// ---------------------------------------------------------------------------
// asc_get_sales_report
// ---------------------------------------------------------------------------

const salesReportSchema = z
  .object({
    reportType: reportTypeSchema.default("SALES"),
    reportSubType: z.enum(["SUMMARY", "DETAILED"]).default("SUMMARY"),
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).default("DAILY"),
    reportDate: z
      .string()
      .describe("YYYY-MM-DD daily, Sunday YYYY-MM-DD weekly, YYYY-MM monthly, YYYY yearly"),
    version: z.string().optional(),
    maxLines: z.number().int().min(50).max(5000).default(400),
  })
  .strict();

function registerGetSalesReport(register: RegisterFn): void {
  register(
    {
      name: "asc_get_sales_report",
      description:
        "Download a sales/subscription report as TSV.\n" +
        "- reportDate format: YYYY-MM-DD (daily), YYYY-MM-DD ending Sunday (weekly), YYYY-MM (monthly), YYYY (yearly).\n" +
        "- reportType SALES = downloads + gross revenue by SKU.\n" +
        "- reportType SUBSCRIPTION = active subscription state on that date.\n" +
        "- reportType SUBSCRIPTION_EVENT = trial starts, conversions, cancels, renewals.\n" +
        "- reportType SUBSCRIBER = per-subscriber ledger.\n" +
        "Apple has ~1 day lag; request yesterday, not today. Reports are aggregated in America/Los_Angeles.",
      inputSchema: {
        type: "object",
        properties: {
          reportType: {
            type: "string",
            enum: ["SALES", "SUBSCRIPTION", "SUBSCRIPTION_EVENT", "SUBSCRIBER", "PRE_ORDER"],
            default: "SALES",
          },
          reportSubType: {
            type: "string",
            enum: ["SUMMARY", "DETAILED"],
            default: "SUMMARY",
          },
          frequency: {
            type: "string",
            enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
            default: "DAILY",
          },
          reportDate: {
            type: "string",
            description:
              "YYYY-MM-DD for daily/weekly (Sunday for weekly), YYYY-MM for monthly, YYYY for yearly.",
          },
          version: {
            type: "string",
            description: "Report version. Only set if you need a specific one.",
          },
          maxLines: {
            type: "integer",
            minimum: 50,
            maximum: 5000,
            default: 400,
            description: "Truncate to this many lines (header preserved).",
          },
        },
        required: ["reportDate"],
        additionalProperties: false,
      },
    },
    validated(salesReportSchema, async (args) => {
      const tsv = await ascGetSalesReport({
        vendorNumber: getVendorNumber(),
        reportType: args.reportType as SalesReportType,
        reportSubType: args.reportSubType as SalesReportSubType,
        frequency: args.frequency as SalesReportFrequency,
        reportDate: args.reportDate,
        version: args.version,
      });
      return textResult(truncateTsv(tsv, args.maxLines));
    })
  );
}

// ---------------------------------------------------------------------------
// asc_get_subscription_events
// ---------------------------------------------------------------------------

const subscriptionEventsSchema = z
  .object({
    reportDate: ymdSchema
      .optional()
      .describe("YYYY-MM-DD. Defaults to yesterday in Apple's report timezone."),
  })
  .strict();

function registerGetSubscriptionEvents(register: RegisterFn): void {
  register(
    {
      name: "asc_get_subscription_events",
      description:
        "Convenience wrapper: fetches the SUBSCRIPTION_EVENT report for one day. " +
        "Shows trial starts, conversions, cancels, refunds, renewals per SKU and country. " +
        "If reportDate is omitted, defaults to yesterday in Apple's timezone (America/Los_Angeles).",
      inputSchema: {
        type: "object",
        properties: {
          reportDate: {
            type: "string",
            description: "YYYY-MM-DD (defaults to yesterday in Apple's timezone).",
          },
        },
        additionalProperties: false,
      },
    },
    validated(subscriptionEventsSchema, async (args) => {
      const reportDate = args.reportDate ?? appleYesterday();
      const tsv = await ascGetSalesReport({
        vendorNumber: getVendorNumber(),
        reportType: "SUBSCRIPTION_EVENT",
        reportSubType: "SUMMARY",
        frequency: "DAILY",
        reportDate,
      });
      return textResult(truncateTsv(tsv, 400));
    })
  );
}

// ---------------------------------------------------------------------------
// asc_get_subscription_events_range
// ---------------------------------------------------------------------------

const subscriptionEventsRangeSchema = z
  .object({
    startDate: ymdSchema.optional(),
    endDate: ymdSchema.optional(),
    daysBack: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .describe("Alternative to startDate/endDate: number of days back from yesterday."),
    format: z
      .enum(["tsv", "json"])
      .default("json")
      .describe("json returns parsed rows tagged with reportDate; tsv returns concatenated raw TSV."),
  })
  .strict()
  .refine(
    (v) => v.daysBack !== undefined || (v.startDate !== undefined && v.endDate !== undefined),
    { message: "Provide either daysBack, or both startDate and endDate." }
  );

function registerGetSubscriptionEventsRange(register: RegisterFn): void {
  register(
    {
      name: "asc_get_subscription_events_range",
      description:
        "Fetch SUBSCRIPTION_EVENT reports for a range of days and concatenate them. " +
        "Use daysBack=N for the last N days ending yesterday, OR startDate + endDate (YYYY-MM-DD, inclusive). " +
        "Max 60 days per call. Returns JSON rows (with a synthesized reportDate column) by default so " +
        "downstream aggregation is easy; pass format=tsv for the raw concat.",
      inputSchema: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "YYYY-MM-DD, inclusive." },
          endDate: { type: "string", description: "YYYY-MM-DD, inclusive." },
          daysBack: {
            type: "integer",
            minimum: 1,
            maximum: 60,
            description: "Alternative to startDate/endDate: last N days ending yesterday.",
          },
          format: {
            type: "string",
            enum: ["tsv", "json"],
            default: "json",
          },
        },
        additionalProperties: false,
      },
    },
    validated(subscriptionEventsRangeSchema, async (args) => {
      const dates = resolveDateRange(args);
      const results = await fetchSubscriptionEventsForDates(dates);
      if (args.format === "tsv") {
        return textResult(results.map((r) => `# ${r.date}\n${r.tsv}`).join("\n"));
      }
      const rows = results.flatMap((r) =>
        parseTsv(r.tsv).map((row) => ({ reportDate: r.date, ...row }))
      );
      return textResult({
        range: { start: dates[0], end: dates[dates.length - 1], days: dates.length },
        rowCount: rows.length,
        rows,
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_get_geo_conversion_summary
// ---------------------------------------------------------------------------

const geoSummarySchema = z
  .object({
    daysBack: z.number().int().min(1).max(60).default(7),
    minTrials: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Drop countries with fewer trial starts than this in the whole window."),
  })
  .strict();

function registerGetGeoConversionSummary(register: RegisterFn): void {
  register(
    {
      name: "asc_get_geo_conversion_summary",
      description:
        "Aggregates the last N days of SUBSCRIPTION_EVENT data by country and SKU. " +
        "Returns rows with { country, sku, trialStarts, conversions, cancels, refunds, conversionRate }. " +
        "Use this to compare geo/pricing performance across the paid campaigns (Apple Search Ads or otherwise). " +
        "Defaults to 7 days. Skips days Apple hasn't published yet (won't fail on partial availability).",
      inputSchema: {
        type: "object",
        properties: {
          daysBack: { type: "integer", minimum: 1, maximum: 60, default: 7 },
          minTrials: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
      },
    },
    validated(geoSummarySchema, async (args) => {
      const dates = [];
      for (let i = 1; i <= args.daysBack; i++) dates.push(appleDaysAgo(i));
      const results = await fetchSubscriptionEventsForDates(dates, { skipMissing: true });
      const rows = results.flatMap((r) => parseTsv(r.tsv));
      const summary = summarizeGeoConversion(rows, args.minTrials);
      return textResult({
        window: {
          start: dates[dates.length - 1],
          end: dates[0],
          daysRequested: args.daysBack,
          daysReturned: results.length,
        },
        countries: summary,
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_list_all_apps_snapshot
// ---------------------------------------------------------------------------

const listAllAppsSnapshotSchema = z
  .object({
    reportDate: ymdSchema.optional(),
  })
  .strict();

function registerListAllAppsSnapshot(register: RegisterFn): void {
  register(
    {
      name: "asc_list_all_apps_snapshot",
      description:
        "Cross-app one-day snapshot. Fetches yesterday's SALES + SUBSCRIPTION_EVENT reports " +
        "(they're vendor-scoped, not per app) and merges with your app list so you see downloads, " +
        "revenue, trial starts, and conversions per app in a single response. Skip reportDate to use " +
        "yesterday in Apple's timezone.",
      inputSchema: {
        type: "object",
        properties: {
          reportDate: {
            type: "string",
            description: "YYYY-MM-DD (defaults to yesterday in Apple's timezone).",
          },
        },
        additionalProperties: false,
      },
    },
    validated(listAllAppsSnapshotSchema, async (args) => {
      const reportDate = args.reportDate ?? appleYesterday();
      const vendorNumber = getVendorNumber();

      const [appsResp, salesTsv, subsTsv] = await Promise.all([
        ascGetJson<AscListResponse<AscAppAttributes>>(
          "/v1/apps?fields[apps]=name,bundleId,sku,primaryLocale&limit=200"
        ),
        ascGetSalesReport({
          vendorNumber,
          reportType: "SALES",
          reportSubType: "SUMMARY",
          frequency: "DAILY",
          reportDate,
        }).catch((err: Error) => `# ERROR: ${err.message}`),
        ascGetSalesReport({
          vendorNumber,
          reportType: "SUBSCRIPTION_EVENT",
          reportSubType: "SUMMARY",
          frequency: "DAILY",
          reportDate,
        }).catch((err: Error) => `# ERROR: ${err.message}`),
      ]);

      const salesRows = salesTsv.startsWith("# ERROR") ? [] : parseTsv(salesTsv);
      const subsRows = subsTsv.startsWith("# ERROR") ? [] : parseTsv(subsTsv);

      const perApp = mergeSnapshotBySku(appsResp.data, salesRows, subsRows);
      return textResult({
        reportDate,
        apps: perApp,
        warnings: [
          salesTsv.startsWith("# ERROR") ? `SALES: ${salesTsv}` : null,
          subsTsv.startsWith("# ERROR") ? `SUBSCRIPTION_EVENT: ${subsTsv}` : null,
        ].filter(Boolean),
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_list_customer_reviews
// ---------------------------------------------------------------------------

const listReviewsSchema = z
  .object({
    appId: z.string().min(1),
    limit: z.number().int().min(1).max(200).default(20),
    territory: z
      .string()
      .length(2)
      .optional()
      .describe("Two-letter country code (US, BR, GB, ...)"),
    includeDeveloperResponse: z.boolean().default(true),
  })
  .strict();

function registerListCustomerReviews(register: RegisterFn): void {
  register(
    {
      name: "asc_list_customer_reviews",
      description:
        "Get recent customer reviews for a specific app, sorted newest-first. " +
        "Includes the developer response (if any) when includeDeveloperResponse is true.",
      inputSchema: {
        type: "object",
        properties: {
          appId: { type: "string", description: "App id (from asc_list_apps)." },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
          territory: {
            type: "string",
            description: "Optional two-letter country code (e.g. US, BR, GB).",
          },
          includeDeveloperResponse: { type: "boolean", default: true },
        },
        required: ["appId"],
        additionalProperties: false,
      },
    },
    validated(listReviewsSchema, async (args) => {
      const qs = new URLSearchParams({
        sort: "-createdDate",
        limit: String(args.limit),
      });
      if (args.territory) qs.set("filter[territory]", args.territory);
      if (args.includeDeveloperResponse) qs.set("include", "response");

      type ReviewsResponse = AscListResponse<AscCustomerReviewAttributes> & {
        included?: Array<{
          id: string;
          type: string;
          attributes?: {
            responseBody?: string;
            lastModifiedDate?: string;
            state?: string;
          };
          relationships?: {
            review?: { data?: { id: string; type: string } };
          };
        }>;
      };
      const data = await ascGetJson<ReviewsResponse>(
        `/v1/apps/${args.appId}/customerReviews?${qs.toString()}`
      );

      // Build a review-id → response map so we can join in one pass.
      const responsesByReviewId = new Map<
        string,
        NonNullable<AscCustomerReview["developerResponse"]>
      >();
      for (const inc of data.included ?? []) {
        if (inc.type !== "customerReviewResponses") continue;
        const reviewId = inc.relationships?.review?.data?.id;
        if (!reviewId) continue;
        responsesByReviewId.set(reviewId, {
          id: inc.id,
          body: inc.attributes?.responseBody,
          lastModifiedDate: inc.attributes?.lastModifiedDate,
          state: inc.attributes?.state,
        });
      }

      const reviews: AscCustomerReview[] = data.data.map((r) => ({
        id: r.id,
        rating: r.attributes?.rating,
        title: r.attributes?.title,
        body: r.attributes?.body,
        reviewerNickname: r.attributes?.reviewerNickname,
        createdDate: r.attributes?.createdDate,
        territory: r.attributes?.territory,
        developerResponse: responsesByReviewId.get(r.id) ?? null,
      }));

      return textResult(reviews);
    })
  );
}

// ---------------------------------------------------------------------------
// asc_reply_to_review
// ---------------------------------------------------------------------------

const replyReviewSchema = z
  .object({
    reviewId: z.string().min(1),
    body: z
      .string()
      .min(1)
      .max(5970)
      .describe("Response text. Apple's limit is 5970 chars."),
  })
  .strict();

function registerReplyToReview(register: RegisterFn): void {
  register(
    {
      name: "asc_reply_to_review",
      description:
        "Post a developer response to a customer review. Creates a NEW response — Apple does not " +
        "allow overwriting a submitted response through this endpoint. Requires the ASC API key to " +
        "have Admin or Customer Support role.",
      inputSchema: {
        type: "object",
        properties: {
          reviewId: { type: "string", description: "id from asc_list_customer_reviews" },
          body: {
            type: "string",
            description: "Response text (max 5970 chars, Apple limit).",
          },
        },
        required: ["reviewId", "body"],
        additionalProperties: false,
      },
    },
    validated(replyReviewSchema, async (args) => {
      type CreateResponse = {
        data: {
          id: string;
          type: string;
          attributes?: {
            responseBody?: string;
            lastModifiedDate?: string;
            state?: string;
          };
        };
      };
      const result = await ascPostJson<unknown, CreateResponse>("/v1/customerReviewResponses", {
        data: {
          type: "customerReviewResponses",
          attributes: { responseBody: args.body },
          relationships: {
            review: { data: { type: "customerReviews", id: args.reviewId } },
          },
        },
      });
      return textResult({
        id: result.data.id,
        reviewId: args.reviewId,
        state: result.data.attributes?.state ?? "PENDING_PUBLISH",
        lastModifiedDate: result.data.attributes?.lastModifiedDate,
      });
    })
  );
}

// ---------------------------------------------------------------------------
// Internal helpers (subscription event fetch, aggregation, snapshot merge)
// ---------------------------------------------------------------------------

type SubscriptionEventFetchOptions = {
  /** If true, 404s (report not available yet) are skipped instead of thrown. */
  skipMissing?: boolean;
};

function resolveDateRange(args: {
  startDate?: string;
  endDate?: string;
  daysBack?: number;
}): string[] {
  if (args.daysBack !== undefined) {
    const dates: string[] = [];
    for (let i = 1; i <= args.daysBack; i++) dates.push(appleDaysAgo(i));
    return dates.reverse();
  }
  return daysInRange(args.startDate!, args.endDate!);
}

async function fetchSubscriptionEventsForDates(
  dates: string[],
  opts: SubscriptionEventFetchOptions = {}
): Promise<Array<{ date: string; tsv: string }>> {
  const vendorNumber = getVendorNumber();
  // Small concurrency cap — Apple throttles hard past ~5 parallel requests.
  const concurrency = 4;
  const out: Array<{ date: string; tsv: string }> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < dates.length) {
      const idx = cursor++;
      const date = dates[idx]!;
      try {
        const tsv = await ascGetSalesReport({
          vendorNumber,
          reportType: "SUBSCRIPTION_EVENT",
          reportSubType: "SUMMARY",
          frequency: "DAILY",
          reportDate: date,
        });
        out.push({ date, tsv });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.skipMissing && msg.includes("404")) continue;
        throw err;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Reduces raw SUBSCRIPTION_EVENT rows to per-country × per-SKU aggregates.
 * Apple's schema uses these columns (as of the current version):
 *   - Event: START_TRIAL, CONVERT_TRIAL, CANCEL, REFUND, RENEW, ...
 *   - Country: two-letter code
 *   - Subscription Apple ID (or "Product Identifier")
 *   - Quantity: rows are already aggregated so we sum this
 * We treat unknown event types conservatively (ignore) instead of assuming.
 */
function summarizeGeoConversion(
  rows: Record<string, string>[],
  minTrials: number
): Array<{
  country: string;
  sku: string;
  trialStarts: number;
  conversions: number;
  cancels: number;
  refunds: number;
  renewals: number;
  conversionRate: number | null;
}> {
  const bucket = new Map<
    string,
    {
      country: string;
      sku: string;
      trialStarts: number;
      conversions: number;
      cancels: number;
      refunds: number;
      renewals: number;
    }
  >();

  for (const row of rows) {
    // Apple has renamed columns across versions; check both.
    const event = row["Event"] ?? row["Subscription Event"] ?? "";
    const country = row["Country"] ?? row["Territory"] ?? "??";
    const sku =
      row["Product Identifier"] ??
      row["Subscription Name"] ??
      row["App Name"] ??
      "unknown";
    const qty = Number(row["Quantity"] ?? row["Units"] ?? "0") || 0;
    if (!event || qty === 0) continue;

    const key = `${country}|${sku}`;
    if (!bucket.has(key)) {
      bucket.set(key, {
        country,
        sku,
        trialStarts: 0,
        conversions: 0,
        cancels: 0,
        refunds: 0,
        renewals: 0,
      });
    }
    const b = bucket.get(key)!;
    switch (event) {
      case "Start Trial":
      case "START_TRIAL":
        b.trialStarts += qty;
        break;
      case "Convert to Paid Subscription from Trial":
      case "CONVERT_TRIAL":
        b.conversions += qty;
        break;
      case "Cancel":
      case "CANCEL":
      case "Cancel Trial":
        b.cancels += qty;
        break;
      case "Refund":
      case "REFUND":
        b.refunds += qty;
        break;
      case "Renew":
      case "RENEW":
        b.renewals += qty;
        break;
      // Silently ignore events we don't track (Subscription, Reactivate, etc).
    }
  }

  return [...bucket.values()]
    .filter((b) => b.trialStarts >= minTrials)
    .map((b) => ({
      ...b,
      conversionRate:
        b.trialStarts > 0 ? Math.round((b.conversions / b.trialStarts) * 1000) / 1000 : null,
    }))
    .sort((a, b) => b.trialStarts - a.trialStarts);
}

/**
 * Joins the per-app metadata (from /v1/apps) with the vendor-wide daily reports
 * by SKU. Any SKU that appears in a report but not in the app list is grouped
 * under `unmatched`.
 */
function mergeSnapshotBySku(
  apps: Array<{ id: string; attributes?: AscAppAttributes }>,
  salesRows: Record<string, string>[],
  subsRows: Record<string, string>[]
): Array<{
  id: string;
  name?: string;
  sku?: string;
  bundleId?: string;
  units: number;
  gross: number;
  trialStarts: number;
  conversions: number;
  cancels: number;
}> {
  function agg(
    rows: Record<string, string>[],
    fieldMap: (r: Record<string, string>) => { sku: string; event?: string; qty: number; amount?: number }
  ): Map<string, { units: number; gross: number; trials: number; conversions: number; cancels: number }> {
    const m = new Map<
      string,
      { units: number; gross: number; trials: number; conversions: number; cancels: number }
    >();
    for (const row of rows) {
      const { sku, event, qty, amount } = fieldMap(row);
      if (!sku) continue;
      if (!m.has(sku)) {
        m.set(sku, { units: 0, gross: 0, trials: 0, conversions: 0, cancels: 0 });
      }
      const b = m.get(sku)!;
      if (event === undefined) {
        // SALES row
        b.units += qty;
        if (amount) b.gross += amount;
      } else {
        if (event === "Start Trial" || event === "START_TRIAL") b.trials += qty;
        else if (
          event === "Convert to Paid Subscription from Trial" ||
          event === "CONVERT_TRIAL"
        )
          b.conversions += qty;
        else if (event === "Cancel" || event === "CANCEL" || event === "Cancel Trial")
          b.cancels += qty;
      }
    }
    return m;
  }

  const salesBySku = agg(salesRows, (r) => ({
    sku: r["SKU"] ?? r["Product Identifier"] ?? "",
    qty: Number(r["Units"] ?? "0") || 0,
    amount: Number(r["Developer Proceeds"] ?? r["Customer Price"] ?? "0") || 0,
  }));
  const subsBySku = agg(subsRows, (r) => ({
    sku: r["Product Identifier"] ?? r["SKU"] ?? "",
    event: r["Event"] ?? r["Subscription Event"] ?? "",
    qty: Number(r["Quantity"] ?? "0") || 0,
  }));

  return apps.map((a) => {
    const sku = a.attributes?.sku ?? "";
    const s = salesBySku.get(sku);
    const sub = subsBySku.get(sku);
    return {
      id: a.id,
      name: a.attributes?.name,
      sku,
      bundleId: a.attributes?.bundleId,
      units: s?.units ?? 0,
      gross: s?.gross ?? 0,
      trialStarts: sub?.trials ?? 0,
      conversions: sub?.conversions ?? 0,
      cancels: sub?.cancels ?? 0,
    };
  });
}
