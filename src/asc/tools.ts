import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolHandler } from "../index.js";
import { ascGetJson, ascGetSalesReport } from "./client.js";

type RegisterFn = (tool: Tool, handler: ToolHandler) => void;

const MAX_TSV = 60_000;

function truncate(tsv: string): string {
  return tsv.length > MAX_TSV
    ? `${tsv.slice(0, MAX_TSV)}\n... [truncated, total=${tsv.length}]`
    : tsv;
}

function requireVendor(): string {
  const v = process.env.ASC_VENDOR_NUMBER;
  if (!v) throw new Error("ASC_VENDOR_NUMBER is not set");
  return v;
}

export function registerAscTools(register: RegisterFn): void {
  register(
    {
      name: "asc_list_apps",
      description:
        "List all apps in your App Store Connect account. Returns id, name, bundleId, sku, primaryLocale. Use this to discover appIds for other tools.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    async () => {
      const data = await ascGetJson<{ data: any[] }>(
        "/v1/apps?fields[apps]=name,bundleId,sku,primaryLocale&limit=200"
      );
      const apps = data.data.map((a: any) => ({
        id: a.id,
        name: a.attributes?.name,
        bundleId: a.attributes?.bundleId,
        sku: a.attributes?.sku,
        primaryLocale: a.attributes?.primaryLocale,
      }));
      return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
    }
  );

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
        "Note: Apple has ~1 day lag; request yesterday, not today.",
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
        },
        required: ["reportDate"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const tsv = await ascGetSalesReport({
        vendorNumber: requireVendor(),
        reportType: (args.reportType as any) ?? "SALES",
        reportSubType: (args.reportSubType as any) ?? "SUMMARY",
        frequency: (args.frequency as any) ?? "DAILY",
        reportDate: args.reportDate as string,
        version: args.version as string | undefined,
      });
      return { content: [{ type: "text", text: truncate(tsv) }] };
    }
  );

  register(
    {
      name: "asc_get_subscription_events",
      description:
        "Convenience wrapper: fetches the SUBSCRIPTION_EVENT report for one day. Shows trial starts, conversions, cancels, refunds, renewals per SKU.",
      inputSchema: {
        type: "object",
        properties: {
          reportDate: {
            type: "string",
            description: "YYYY-MM-DD (typically yesterday, since today may not be available).",
          },
        },
        required: ["reportDate"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const tsv = await ascGetSalesReport({
        vendorNumber: requireVendor(),
        reportType: "SUBSCRIPTION_EVENT",
        reportSubType: "SUMMARY",
        frequency: "DAILY",
        reportDate: args.reportDate as string,
      });
      return { content: [{ type: "text", text: truncate(tsv) }] };
    }
  );

  register(
    {
      name: "asc_list_customer_reviews",
      description: "Get recent customer reviews for a specific app, sorted newest-first.",
      inputSchema: {
        type: "object",
        properties: {
          appId: { type: "string", description: "App id (from asc_list_apps)." },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
          territory: {
            type: "string",
            description: "Optional two-letter country code (e.g. US, BR, GB).",
          },
        },
        required: ["appId"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const qs = new URLSearchParams({
        sort: "-createdDate",
        limit: String(args.limit ?? 20),
      });
      if (args.territory) qs.set("filter[territory]", String(args.territory));
      const data = await ascGetJson<{ data: any[] }>(
        `/v1/apps/${args.appId}/customerReviews?${qs.toString()}`
      );
      const reviews = data.data.map((r: any) => ({
        id: r.id,
        rating: r.attributes?.rating,
        title: r.attributes?.title,
        body: r.attributes?.body,
        reviewerNickname: r.attributes?.reviewerNickname,
        createdDate: r.attributes?.createdDate,
        territory: r.attributes?.territory,
      }));
      return { content: [{ type: "text", text: JSON.stringify(reviews, null, 2) }] };
    }
  );
}
