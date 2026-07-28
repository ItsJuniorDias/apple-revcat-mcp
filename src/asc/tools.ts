import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolHandler } from "../index.js";
import { ascGetJson, ascGetSalesReport, ascPostJson } from "./client.js";
import { getVendorNumber } from "./auth.js";
import { textResult, validated } from "../utils/tool.js";
import { parseTsv, truncateTsv } from "../utils/tsv.js";
import { appleYesterday, appleDaysAgo, daysInRange, isValidYmd } from "../utils/dates.js";
import {
  createAnalyticsReportRequest,
  downloadAllSegments,
  findEngagementReport,
  listAnalyticsReportInstances,
  listAnalyticsReportRequests,
  listAnalyticsReports,
  type AnalyticsAccessType,
  type AnalyticsGranularity,
  type AnalyticsReportCategory,
} from "./analytics.js";
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
  // ----- Analytics Reports API (async pipeline; separate from Sales/Trends) -----
  registerListAnalyticsReportRequests(register);
  registerCreateAnalyticsReportRequest(register);
  registerListAnalyticsReports(register);
  registerListAnalyticsReportInstances(register);
  registerGetAnalyticsReportSegments(register);
  registerGetEngagementFunnel(register);
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
// Analytics Reports API — shared schemas
// ---------------------------------------------------------------------------

const accessTypeSchema = z.enum(["ONGOING", "ONE_TIME_SNAPSHOT"]);

const analyticsCategorySchema = z.enum([
  "APP_USAGE",
  "APP_STORE_ENGAGEMENT",
  "COMMERCE",
  "FRAMEWORKS_USAGE",
  "PERFORMANCE",
]);

const granularitySchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);

// ---------------------------------------------------------------------------
// asc_list_analytics_report_requests
// ---------------------------------------------------------------------------

const listReportRequestsSchema = z
  .object({
    appId: z.string().min(1),
    accessType: accessTypeSchema.optional(),
  })
  .strict();

function registerListAnalyticsReportRequests(register: RegisterFn): void {
  register(
    {
      name: "asc_list_analytics_report_requests",
      description:
        "List analytics report requests already created for an app. Read-only. " +
        "Returns { id, accessType (ONGOING|ONE_TIME_SNAPSHOT), stoppedDueToInactivity }. " +
        "Use this before asc_create_analytics_report_request to avoid creating a duplicate. " +
        "If stoppedDueToInactivity=true, Apple has paused that request and you'll need to " +
        "create a new one to resume ingestion.",
      inputSchema: {
        type: "object",
        properties: {
          appId: { type: "string", description: "App id (from asc_list_apps)." },
          accessType: {
            type: "string",
            enum: ["ONGOING", "ONE_TIME_SNAPSHOT"],
            description: "Filter by access type. Omit to return both.",
          },
        },
        required: ["appId"],
        additionalProperties: false,
      },
    },
    validated(listReportRequestsSchema, async (args) => {
      const requests = await listAnalyticsReportRequests(args.appId, args.accessType);
      return textResult({
        appId: args.appId,
        count: requests.length,
        requests: requests.map((r) => ({
          id: r.id,
          accessType: r.attributes?.accessType,
          stoppedDueToInactivity: r.attributes?.stoppedDueToInactivity ?? false,
        })),
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_create_analytics_report_request
// ---------------------------------------------------------------------------

const createReportRequestSchema = z
  .object({
    appId: z.string().min(1),
    accessType: accessTypeSchema.default("ONGOING"),
  })
  .strict();

function registerCreateAnalyticsReportRequest(register: RegisterFn): void {
  register(
    {
      name: "asc_create_analytics_report_request",
      description:
        "Create a new analytics report request for an app. This is the FIRST step to " +
        "unlock the App Analytics data pipeline (impressions, product page views, " +
        "downloads by source × country, sessions, retention, crashes, etc). " +
        "accessType=ONGOING (default) starts recurring daily/weekly/monthly reports " +
        "— the first data arrives ~24-48h after creation. accessType=ONE_TIME_SNAPSHOT " +
        "gives you the full historical dump instead. " +
        "First-time creation on an app requires the Admin role on the ASC API key; " +
        "afterwards Sales-and-Reports / Finance keys can read from it. Call " +
        "asc_list_analytics_report_requests first to avoid creating a duplicate.",
      inputSchema: {
        type: "object",
        properties: {
          appId: { type: "string", description: "App id (from asc_list_apps)." },
          accessType: {
            type: "string",
            enum: ["ONGOING", "ONE_TIME_SNAPSHOT"],
            default: "ONGOING",
          },
        },
        required: ["appId"],
        additionalProperties: false,
      },
    },
    validated(createReportRequestSchema, async (args) => {
      const created = await createAnalyticsReportRequest(args.appId, args.accessType);
      return textResult({
        id: created.id,
        accessType: created.attributes?.accessType ?? args.accessType,
        stoppedDueToInactivity: created.attributes?.stoppedDueToInactivity ?? false,
        notice:
          args.accessType === "ONGOING"
            ? "Request created. First report instances usually appear 24-48h later. " +
              "Poll asc_list_analytics_report_instances after that window."
            : "Snapshot request created. Historical data will be generated over the next 24-48h.",
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_list_analytics_reports
// ---------------------------------------------------------------------------

const listReportsSchema = z
  .object({
    requestId: z.string().min(1),
    category: analyticsCategorySchema.optional(),
    nameContains: z
      .string()
      .min(1)
      .optional()
      .describe("Case-insensitive substring filter on report name (client-side)."),
  })
  .strict();

function registerListAnalyticsReports(register: RegisterFn): void {
  register(
    {
      name: "asc_list_analytics_reports",
      description:
        "List the report schemas available inside a report request. Each report is a " +
        "specific dataset (e.g. 'App Store Discovery and Engagement Standard', " +
        "'App Sessions Detailed'). Filter by category to narrow: " +
        "APP_STORE_ENGAGEMENT (impressions, product page views, downloads by source), " +
        "APP_USAGE (sessions, active devices, retention, crashes, uninstalls), " +
        "COMMERCE (proceeds, transactions, subscription state), " +
        "FRAMEWORKS_USAGE, PERFORMANCE. " +
        "Returns { id, name, category }. Get the requestId from asc_list_analytics_report_requests.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "Report request id (from asc_list_analytics_report_requests).",
          },
          category: {
            type: "string",
            enum: [
              "APP_USAGE",
              "APP_STORE_ENGAGEMENT",
              "COMMERCE",
              "FRAMEWORKS_USAGE",
              "PERFORMANCE",
            ],
          },
          nameContains: {
            type: "string",
            description: "Case-insensitive substring filter on report name.",
          },
        },
        required: ["requestId"],
        additionalProperties: false,
      },
    },
    validated(listReportsSchema, async (args) => {
      const reports = await listAnalyticsReports(args.requestId, args.category);
      const needle = args.nameContains?.toLowerCase();
      const filtered = needle
        ? reports.filter((r) => (r.attributes?.name ?? "").toLowerCase().includes(needle))
        : reports;
      return textResult({
        requestId: args.requestId,
        count: filtered.length,
        reports: filtered.map((r) => ({
          id: r.id,
          name: r.attributes?.name,
          category: r.attributes?.category,
        })),
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_list_analytics_report_instances
// ---------------------------------------------------------------------------

const listInstancesSchema = z
  .object({
    reportId: z.string().min(1),
    granularity: granularitySchema.optional(),
    processingDate: ymdSchema
      .optional()
      .describe("YYYY-MM-DD (report's local processing date, not calendar date)."),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();

function registerListAnalyticsReportInstances(register: RegisterFn): void {
  register(
    {
      name: "asc_list_analytics_report_instances",
      description:
        "List instances of a specific report — each instance is one date at one " +
        "granularity (DAILY/WEEKLY/MONTHLY). Returns { id, granularity, processingDate }. " +
        "Filter by granularity to avoid mixing daily/weekly/monthly. Filter by " +
        "processingDate for a specific day. If empty for a recent date, either the report " +
        "hasn't been generated yet (24-48h lag) or the data isn't ready (2-day completeness).",
      inputSchema: {
        type: "object",
        properties: {
          reportId: {
            type: "string",
            description: "Report id (from asc_list_analytics_reports).",
          },
          granularity: {
            type: "string",
            enum: ["DAILY", "WEEKLY", "MONTHLY"],
          },
          processingDate: {
            type: "string",
            description: "YYYY-MM-DD to filter to one specific date.",
          },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
        required: ["reportId"],
        additionalProperties: false,
      },
    },
    validated(listInstancesSchema, async (args) => {
      const instances = await listAnalyticsReportInstances(args.reportId, {
        granularity: args.granularity,
        processingDate: args.processingDate,
        limit: args.limit,
      });
      // Newest first — most callers want the latest data.
      instances.sort((a, b) =>
        (b.attributes?.processingDate ?? "").localeCompare(a.attributes?.processingDate ?? "")
      );
      return textResult({
        reportId: args.reportId,
        count: instances.length,
        instances: instances.map((i) => ({
          id: i.id,
          granularity: i.attributes?.granularity,
          processingDate: i.attributes?.processingDate,
        })),
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_get_analytics_report_segments
// ---------------------------------------------------------------------------

const getSegmentsSchema = z
  .object({
    instanceId: z.string().min(1),
    format: z.enum(["json", "tsv"]).default("json"),
    maxLines: z.number().int().min(50).max(5000).default(400),
    maxRows: z
      .number()
      .int()
      .min(50)
      .max(5000)
      .default(400)
      .describe("For format=json, max rows returned in `rows`. `rowCount` is always full."),
  })
  .strict();

function registerGetAnalyticsReportSegments(register: RegisterFn): void {
  register(
    {
      name: "asc_get_analytics_report_segments",
      description:
        "Downloads every segment of a report instance, decompresses the gzipped TSV, " +
        "and returns the data. format=json (default) parses rows into { column: value } " +
        "objects and reports column names — ideal for the model to reason about the data. " +
        "format=tsv returns the raw concatenated TSV (with duplicate headers stripped). " +
        "Big instances have multiple segments; they're fetched in parallel.",
      inputSchema: {
        type: "object",
        properties: {
          instanceId: {
            type: "string",
            description: "Instance id (from asc_list_analytics_report_instances).",
          },
          format: {
            type: "string",
            enum: ["json", "tsv"],
            default: "json",
          },
          maxLines: {
            type: "integer",
            minimum: 50,
            maximum: 5000,
            default: 400,
            description: "For format=tsv, max lines returned (header preserved).",
          },
          maxRows: {
            type: "integer",
            minimum: 50,
            maximum: 5000,
            default: 400,
            description: "For format=json, max rows returned. rowCount is always the full total.",
          },
        },
        required: ["instanceId"],
        additionalProperties: false,
      },
    },
    validated(getSegmentsSchema, async (args) => {
      const dl = await downloadAllSegments(args.instanceId);
      if (dl.segmentCount === 0) {
        return textResult({
          instanceId: args.instanceId,
          segmentCount: 0,
          notice:
            "This instance has no segments — Apple hasn't finished generating it yet, " +
            "or the underlying data is empty for the day.",
        });
      }
      if (args.format === "tsv") {
        return textResult(truncateTsv(dl.tsv, args.maxLines));
      }
      const rows = parseTsv(dl.tsv);
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
      const truncated = rows.length > args.maxRows;
      return textResult({
        instanceId: args.instanceId,
        segmentCount: dl.segmentCount,
        bytes: dl.bytes,
        columns,
        rowCount: rows.length,
        truncated,
        rows: truncated ? rows.slice(0, args.maxRows) : rows,
      });
    })
  );
}

// ---------------------------------------------------------------------------
// asc_get_engagement_funnel
// ---------------------------------------------------------------------------

const engagementFunnelSchema = z
  .object({
    appId: z.string().min(1),
    daysBack: z.number().int().min(1).max(30).default(7),
    granularity: granularitySchema.default("DAILY"),
    autoCreate: z
      .boolean()
      .default(false)
      .describe(
        "If true and no ONGOING request exists, create one automatically. Note: creation " +
          "requires the Admin role and data only becomes available 24-48h later."
      ),
    detailed: z
      .boolean()
      .default(false)
      .describe(
        "Prefer the Detailed variant of the engagement report (adds Source Info, Campaign ID, " +
          "Page Title). Much bigger payload; only enable if you need paid-campaign attribution."
      ),
    maxSampleRows: z
      .number()
      .int()
      .min(0)
      .max(500)
      .default(50)
      .describe("Sample rows returned alongside the aggregate (for schema inspection). 0 = none."),
  })
  .strict();

function registerGetEngagementFunnel(register: RegisterFn): void {
  register(
    {
      name: "asc_get_engagement_funnel",
      description:
        "High-level wrapper: fetches the App Store Engagement report for an app and " +
        "aggregates the funnel (impressions → product page views → downloads → conversion) " +
        "by Territory × Source Type for the last N days. This is what you want for ASA " +
        "geo optimization and 'is Search Ads winning auctions here?' questions. " +
        "Requires that an analyticsReportRequest already exists for the app — call " +
        "asc_list_analytics_report_requests first, or set autoCreate=true. Data lags 24-48h.",
      inputSchema: {
        type: "object",
        properties: {
          appId: { type: "string", description: "App id (from asc_list_apps)." },
          daysBack: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            default: 7,
            description: "How many recent days to fetch (max 30).",
          },
          granularity: {
            type: "string",
            enum: ["DAILY", "WEEKLY", "MONTHLY"],
            default: "DAILY",
          },
          autoCreate: {
            type: "boolean",
            default: false,
            description:
              "Create an ONGOING request if none exists (needs Admin role, 24-48h wait).",
          },
          detailed: {
            type: "boolean",
            default: false,
            description: "Use the Detailed engagement report variant.",
          },
          maxSampleRows: {
            type: "integer",
            minimum: 0,
            maximum: 500,
            default: 50,
          },
        },
        required: ["appId"],
        additionalProperties: false,
      },
    },
    validated(engagementFunnelSchema, async (args) => {
      let report = await findEngagementReport(args.appId, { preferDetailed: args.detailed });

      if (!report) {
        if (!args.autoCreate) {
          return textResult({
            status: "no_report_request",
            appId: args.appId,
            hint:
              "No active analyticsReportRequest exists for this app. Call " +
              "asc_create_analytics_report_request with accessType=ONGOING (requires " +
              "Admin role) and wait 24-48h, or set autoCreate=true on this call.",
          });
        }
        const created = await createAnalyticsReportRequest(args.appId, "ONGOING");
        return textResult({
          status: "created_wait_for_data",
          appId: args.appId,
          createdRequestId: created.id,
          notice:
            "Created a new ONGOING report request. Apple takes 24-48h to publish " +
            "the first instance. Retry asc_get_engagement_funnel after that window.",
        });
      }

      // For each day in the window, list DAILY instances and download them.
      // We do this per-day rather than one big list call so we can bound the
      // number of instances we pull even for busy apps.
      const dates: string[] = [];
      for (let i = 1; i <= args.daysBack; i++) dates.push(appleDaysAgo(i));

      type PerDay = {
        date: string;
        instanceId: string | null;
        rows: Record<string, string>[];
        error?: string;
      };

      const concurrency = Math.min(4, dates.length);
      const perDay: PerDay[] = [];
      let cursor = 0;

      async function worker(): Promise<void> {
        while (cursor < dates.length) {
          const idx = cursor++;
          const date = dates[idx]!;
          try {
            const instances = await listAnalyticsReportInstances(report!.reportId, {
              granularity: args.granularity,
              processingDate: date,
              limit: 1,
            });
            if (instances.length === 0) {
              perDay.push({ date, instanceId: null, rows: [] });
              continue;
            }
            const instanceId = instances[0]!.id;
            const dl = await downloadAllSegments(instanceId);
            const rows = dl.tsv ? parseTsv(dl.tsv) : [];
            perDay.push({ date, instanceId, rows });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            perDay.push({ date, instanceId: null, rows: [], error: msg });
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      perDay.sort((a, b) => a.date.localeCompare(b.date));

      const allRows = perDay.flatMap((d) => d.rows);
      const aggregate = aggregateEngagementRows(allRows);
      const columns = allRows.length > 0 ? Object.keys(allRows[0]!) : [];

      return textResult({
        status: "ok",
        appId: args.appId,
        report: {
          requestId: report.requestId,
          reportId: report.reportId,
          reportName: report.reportName,
          accessType: report.accessType,
        },
        window: {
          start: dates[dates.length - 1],
          end: dates[0],
          daysRequested: args.daysBack,
          daysWithData: perDay.filter((d) => d.rows.length > 0).length,
        },
        perDay: perDay.map((d) => ({
          date: d.date,
          instanceId: d.instanceId,
          rowCount: d.rows.length,
          ...(d.error ? { error: d.error } : {}),
        })),
        columns,
        totalRows: allRows.length,
        aggregate,
        sampleRows: args.maxSampleRows > 0 ? allRows.slice(0, args.maxSampleRows) : [],
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

/**
 * Aggregates rows from the App Store Engagement report into a Territory ×
 * Source Type funnel: impressions → product page views → downloads with a
 * derived conversionRate.
 *
 * Column names in Apple's engagement TSV have shifted between spec versions
 * — we accept a few known aliases per field so a rename doesn't zero out the
 * aggregate silently. Event values also vary: some reports emit "Impression"
 * as a discrete row, others report impressions as a column on a Page view
 * row. We handle both shapes.
 */
function aggregateEngagementRows(rows: Record<string, string>[]): {
  byTerritorySource: Array<{
    territory: string;
    sourceType: string;
    impressions: number;
    productPageViews: number;
    downloads: number;
    conversionRate: number | null;
  }>;
  eventTotals: Record<string, number>;
  totals: {
    impressions: number;
    productPageViews: number;
    downloads: number;
    conversionRate: number | null;
  };
} {
  type Bucket = {
    territory: string;
    sourceType: string;
    impressions: number;
    productPageViews: number;
    downloads: number;
  };
  const buckets = new Map<string, Bucket>();
  const eventTotals: Record<string, number> = {};

  for (const row of rows) {
    const territory = row["Territory"] ?? row["Country"] ?? row["Region"] ?? "??";
    const sourceType =
      row["Source Type"] ?? row["Source"] ?? row["Traffic Source"] ?? "Unknown";
    const event =
      row["Event"] ??
      row["Engagement Type"] ??
      row["Metric"] ??
      row["Event Type"] ??
      "";
    // Some Apple reports use "Counts" (integer sum) and "Unique Devices" side
    // by side. We track Counts as the primary value — that's what the ASC UI
    // displays for impressions/PPV/downloads by default.
    const counts = Number(row["Counts"] ?? row["Count"] ?? row["Units"] ?? "0") || 0;

    if (event) {
      eventTotals[event] = (eventTotals[event] ?? 0) + counts;
    }

    const key = `${territory}|${sourceType}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        territory,
        sourceType,
        impressions: 0,
        productPageViews: 0,
        downloads: 0,
      });
    }
    const b = buckets.get(key)!;

    // Match event to the funnel stages. Naming varies across report versions;
    // the substring tests catch "First-Time Download", "Total Downloads",
    // "Product Page View" etc without hardcoding every spelling.
    const lower = event.toLowerCase();
    if (lower === "impression" || lower.includes("impression")) {
      b.impressions += counts;
    } else if (
      lower.includes("product page view") ||
      lower === "page view" ||
      lower.includes("page view")
    ) {
      b.productPageViews += counts;
    } else if (lower.includes("download") || lower.includes("install")) {
      b.downloads += counts;
    }
    // Silently ignore events that don't map to a funnel stage (Session, Tap
    // through, Notification, etc). They're preserved in eventTotals for the
    // caller to inspect.
  }

  const byTerritorySource = [...buckets.values()]
    .map((b) => ({
      ...b,
      conversionRate:
        b.productPageViews > 0
          ? Math.round((b.downloads / b.productPageViews) * 1000) / 1000
          : null,
    }))
    // Sort by downloads desc — that's the metric people scan for first.
    .sort((a, b) => b.downloads - a.downloads);

  const totals = byTerritorySource.reduce(
    (acc, b) => ({
      impressions: acc.impressions + b.impressions,
      productPageViews: acc.productPageViews + b.productPageViews,
      downloads: acc.downloads + b.downloads,
    }),
    { impressions: 0, productPageViews: 0, downloads: 0 }
  );

  return {
    byTerritorySource,
    eventTotals,
    totals: {
      ...totals,
      conversionRate:
        totals.productPageViews > 0
          ? Math.round((totals.downloads / totals.productPageViews) * 1000) / 1000
          : null,
    },
  };
}
