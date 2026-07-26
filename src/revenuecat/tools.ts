import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolHandler } from "../index.js";
import { rcGet, defaultProjectId } from "./client.js";
import { textResult, validated } from "../utils/tool.js";
import type {
  RcApp,
  RcCustomer,
  RcEntitlement,
  RcListResponse,
  RcProduct,
  RcProject,
} from "./types.js";

type RegisterFn = (tool: Tool, handler: ToolHandler) => void;

// ---------------------------------------------------------------------------
// Shared: project_id resolution
// ---------------------------------------------------------------------------

/**
 * The project_id arg is optional across every tool — if omitted, we fall
 * back to RC_DEFAULT_PROJECT_ID. Users with multiple projects (Pedagogy /
 * Magic World / StoryBox / ...) can either set the env or pass explicitly.
 */
const projectIdField = z
  .string()
  .min(1)
  .optional()
  .describe("RevenueCat project id. Defaults to RC_DEFAULT_PROJECT_ID env if unset.");

function projectIdSchemaJson() {
  return {
    type: "string",
    description:
      "RevenueCat project id. If omitted, RC_DEFAULT_PROJECT_ID from env is used.",
  } as const;
}

function resolveProjectId(args: { project_id?: string }): string {
  return args.project_id ?? defaultProjectId();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRevenueCatTools(register: RegisterFn): void {
  registerListProjects(register);
  registerListApps(register);
  registerListProducts(register);
  registerListEntitlements(register);
  registerListCustomers(register);
  registerGetCustomer(register);
  registerGetCustomerSubscriptions(register);
  registerGetCustomerPurchases(register);
  registerGetProjectSnapshot(register);
}

// ---------------------------------------------------------------------------
// rc_list_projects
// ---------------------------------------------------------------------------

const listProjectsSchema = z.object({}).strict();

function registerListProjects(register: RegisterFn): void {
  register(
    {
      name: "rc_list_projects",
      description: "List all RevenueCat projects your secret key has access to.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    validated(listProjectsSchema, async () =>
      textResult(await rcGet<RcListResponse<RcProject>>("/projects"))
    )
  );
}

// ---------------------------------------------------------------------------
// rc_list_apps
// ---------------------------------------------------------------------------

const listAppsSchema = z
  .object({ project_id: projectIdField })
  .strict();

function registerListApps(register: RegisterFn): void {
  register(
    {
      name: "rc_list_apps",
      description: "List all apps under a RevenueCat project (iOS, Android, web, etc).",
      inputSchema: {
        type: "object",
        properties: { project_id: projectIdSchemaJson() },
        additionalProperties: false,
      },
    },
    validated(listAppsSchema, async (args) => {
      const projectId = resolveProjectId(args);
      return textResult(await rcGet<RcListResponse<RcApp>>(`/projects/${projectId}/apps`));
    })
  );
}

// ---------------------------------------------------------------------------
// rc_list_products
// ---------------------------------------------------------------------------

const listProductsSchema = z
  .object({
    project_id: projectIdField,
    limit: z.number().int().min(1).max(100).default(50),
    starting_after: z.string().optional(),
  })
  .strict();

function registerListProducts(register: RegisterFn): void {
  register(
    {
      name: "rc_list_products",
      description:
        "List products (SKUs) configured in a RevenueCat project. Paginate with starting_after " +
        "(id of the last item from the previous page).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchemaJson(),
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          starting_after: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    validated(listProductsSchema, async (args) => {
      const projectId = resolveProjectId(args);
      const qs = new URLSearchParams({ limit: String(args.limit) });
      if (args.starting_after) qs.set("starting_after", args.starting_after);
      return textResult(
        await rcGet<RcListResponse<RcProduct>>(
          `/projects/${projectId}/products?${qs.toString()}`
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// rc_list_entitlements
// ---------------------------------------------------------------------------

const listEntitlementsSchema = z
  .object({ project_id: projectIdField })
  .strict();

function registerListEntitlements(register: RegisterFn): void {
  register(
    {
      name: "rc_list_entitlements",
      description: "List entitlements configured in a RevenueCat project.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectIdSchemaJson() },
        additionalProperties: false,
      },
    },
    validated(listEntitlementsSchema, async (args) => {
      const projectId = resolveProjectId(args);
      return textResult(
        await rcGet<RcListResponse<RcEntitlement>>(
          `/projects/${projectId}/entitlements`
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// rc_list_customers
// ---------------------------------------------------------------------------

const listCustomersSchema = z
  .object({
    project_id: projectIdField,
    limit: z.number().int().min(1).max(100).default(50),
    starting_after: z.string().optional(),
  })
  .strict();

function registerListCustomers(register: RegisterFn): void {
  register(
    {
      name: "rc_list_customers",
      description:
        "List customers in a RevenueCat project. Paginate with starting_after (id of last item).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchemaJson(),
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          starting_after: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    validated(listCustomersSchema, async (args) => {
      const projectId = resolveProjectId(args);
      const qs = new URLSearchParams({ limit: String(args.limit) });
      if (args.starting_after) qs.set("starting_after", args.starting_after);
      return textResult(
        await rcGet<RcListResponse<RcCustomer>>(
          `/projects/${projectId}/customers?${qs.toString()}`
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// rc_get_customer
// ---------------------------------------------------------------------------

const getCustomerSchema = z
  .object({
    project_id: projectIdField,
    customer_id: z.string().min(1),
  })
  .strict();

function registerGetCustomer(register: RegisterFn): void {
  register(
    {
      name: "rc_get_customer",
      description: "Get details for a single customer by app_user_id.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchemaJson(),
          customer_id: {
            type: "string",
            description: "The app_user_id (or RevenueCat customer id) of the customer.",
          },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    validated(getCustomerSchema, async (args) => {
      const projectId = resolveProjectId(args);
      return textResult(
        await rcGet<RcCustomer>(
          `/projects/${projectId}/customers/${encodeURIComponent(args.customer_id)}`
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// rc_get_customer_subscriptions
// ---------------------------------------------------------------------------

const customerScopedSchema = z
  .object({
    project_id: projectIdField,
    customer_id: z.string().min(1),
  })
  .strict();

function registerGetCustomerSubscriptions(register: RegisterFn): void {
  register(
    {
      name: "rc_get_customer_subscriptions",
      description: "Get all active and expired subscriptions for a customer.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchemaJson(),
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    validated(customerScopedSchema, async (args) => {
      const projectId = resolveProjectId(args);
      return textResult(
        await rcGet(
          `/projects/${projectId}/customers/${encodeURIComponent(args.customer_id)}/subscriptions`
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// rc_get_customer_purchases
// ---------------------------------------------------------------------------

function registerGetCustomerPurchases(register: RegisterFn): void {
  register(
    {
      name: "rc_get_customer_purchases",
      description: "Get all purchases (transactions) for a customer.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchemaJson(),
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    validated(customerScopedSchema, async (args) => {
      const projectId = resolveProjectId(args);
      return textResult(
        await rcGet(
          `/projects/${projectId}/customers/${encodeURIComponent(args.customer_id)}/purchases`
        )
      );
    })
  );
}

// ---------------------------------------------------------------------------
// rc_get_project_snapshot
// ---------------------------------------------------------------------------

const projectSnapshotSchema = z
  .object({
    project_id: projectIdField,
  })
  .strict();

function registerGetProjectSnapshot(register: RegisterFn): void {
  register(
    {
      name: "rc_get_project_snapshot",
      description:
        "One-shot overview of a RevenueCat project: apps, products, entitlements, and a small " +
        "customer sample. Cuts 4+ tool calls down to 1 when you want the big picture of a project.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectIdSchemaJson() },
        additionalProperties: false,
      },
    },
    validated(projectSnapshotSchema, async (args) => {
      const projectId = resolveProjectId(args);
      // Run in parallel — none of these depend on the others.
      const [apps, products, entitlements, customers] = await Promise.all([
        rcGet<RcListResponse<RcApp>>(`/projects/${projectId}/apps`),
        rcGet<RcListResponse<RcProduct>>(`/projects/${projectId}/products?limit=100`),
        rcGet<RcListResponse<RcEntitlement>>(`/projects/${projectId}/entitlements`),
        rcGet<RcListResponse<RcCustomer>>(`/projects/${projectId}/customers?limit=10`),
      ]);
      return textResult({
        project_id: projectId,
        apps: apps.items,
        products: products.items,
        entitlements: entitlements.items,
        recent_customers: customers.items,
        counts: {
          apps: apps.items.length,
          products: products.items.length,
          entitlements: entitlements.items.length,
          recent_customers_shown: customers.items.length,
        },
      });
    })
  );
}
