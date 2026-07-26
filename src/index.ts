#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const registry: ToolRegistration[] = [];

function registerTool(tool: Tool, handler: ToolHandler): void {
  registry.push({ tool, handler });
}

async function main(): Promise<void> {
  registerAscTools(registerTool);
  registerRevenueCatTools(registerTool);

  const server = new Server(
    { name: "apple-revcat-mcp", version: "0.1.0" },
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
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Always log to stderr — stdout is the MCP JSON-RPC channel.
  console.error(`[apple-revcat-mcp] Ready with ${registry.length} tools.`);
}

main().catch((err) => {
  console.error("[apple-revcat-mcp] Fatal:", err);
  process.exit(1);
});
