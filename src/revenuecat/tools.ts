import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolHandler } from "../index.js";
import { rcGet, defaultProjectId } from "./client.js";

type RegisterFn = (tool: Tool, handler: ToolHandler) => void;

const projectIdSchema = {
  type: "string",
  description:
    "RevenueCat project id. If omitted, RC_DEFAULT_PROJECT_ID from env is used.",
} as const;

function resolveProjectId(args: Record<string, unknown>): string {
  return (args.project_id as string) ?? defaultProjectId();
}

function json(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function registerRevenueCatTools(register: RegisterFn): void {
  register(
    {
      name: "rc_list_projects",
      description: "List all RevenueCat projects your secret key has access to.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    async () => json(await rcGet<any>("/projects"))
  );

  register(
    {
      name: "rc_list_apps",
      description: "List all apps under a RevenueCat project (iOS, Android, web, etc).",
      inputSchema: {
        type: "object",
        properties: { project_id: projectIdSchema },
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      return json(await rcGet<any>(`/projects/${projectId}/apps`));
    }
  );

  register(
    {
      name: "rc_list_products",
      description: "List products (SKUs) configured in a RevenueCat project.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchema,
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      const limit = (args.limit as number) ?? 50;
      return json(await rcGet<any>(`/projects/${projectId}/products?limit=${limit}`));
    }
  );

  register(
    {
      name: "rc_list_entitlements",
      description: "List entitlements configured in a RevenueCat project.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectIdSchema },
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      return json(await rcGet<any>(`/projects/${projectId}/entitlements`));
    }
  );

  register(
    {
      name: "rc_list_customers",
      description:
        "List customers in a RevenueCat project. Paginate with starting_after (id of last item).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchema,
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          starting_after: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      const qs = new URLSearchParams();
      qs.set("limit", String(args.limit ?? 50));
      if (args.starting_after) qs.set("starting_after", String(args.starting_after));
      return json(await rcGet<any>(`/projects/${projectId}/customers?${qs.toString()}`));
    }
  );

  register(
    {
      name: "rc_get_customer",
      description: "Get details for a single customer by app_user_id.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchema,
          customer_id: {
            type: "string",
            description: "The app_user_id (or RevenueCat customer id) of the customer.",
          },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      return json(await rcGet<any>(`/projects/${projectId}/customers/${args.customer_id}`));
    }
  );

  register(
    {
      name: "rc_get_customer_subscriptions",
      description: "Get all active and expired subscriptions for a customer.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchema,
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      return json(
        await rcGet<any>(`/projects/${projectId}/customers/${args.customer_id}/subscriptions`)
      );
    }
  );

  register(
    {
      name: "rc_get_customer_purchases",
      description: "Get all purchases (transactions) for a customer.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectIdSchema,
          customer_id: { type: "string" },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const projectId = resolveProjectId(args);
      return json(
        await rcGet<any>(`/projects/${projectId}/customers/${args.customer_id}/purchases`)
      );
    }
  );
}
