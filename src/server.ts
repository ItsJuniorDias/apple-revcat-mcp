import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { registerAscTools } from "./asc/tools.js";
import { registerRevenueCatTools } from "./revenuecat/tools.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

type ToolRegistration = { tool: Tool; handler: ToolHandler };

export type CreatedServer = {
  server: Server;
  toolCount: number;
};

/**
 * Factory that builds a fresh MCP Server with all tools registered.
 *
 * Kept side-effect free (no transport connection) so it can be reused by
 * both the stdio entry (src/index.ts) and the HTTP entry (src/http.ts).
 *
 * The HTTP transport in stateless mode expects a NEW Server instance per
 * request; do NOT cache the returned server across requests.
 */
export function createServer(): CreatedServer {
  const registry: ToolRegistration[] = [];

  const registerTool = (tool: Tool, handler: ToolHandler): void => {
    if (registry.some((r) => r.tool.name === tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.push({ tool, handler });
  };

  registerAscTools(registerTool);
  registerRevenueCatTools(registerTool);

  const server = new Server(
    { name: "apple-revcat-mcp", version: "0.3.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.map((r) => r.tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const found = registry.find((r) => r.tool.name === name);
    if (!found) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      return await found.handler((args ?? {}) as Record<string, unknown>);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Tool ${name} failed:`, message);
      return {
        content: [{ type: "text", text: `Error in ${name}: ${message}` }],
        isError: true,
      };
    }
  });

  return { server, toolCount: registry.length };
}

/**
 * Logger that ALWAYS writes to stderr. Never touch stdout — stdio transport
 * uses it for JSON-RPC frames and any stray write corrupts the stream.
 */
export function logError(...args: unknown[]): void {
  console.error("[apple-revcat-mcp]", ...args);
}
