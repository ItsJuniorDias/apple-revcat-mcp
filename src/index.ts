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

/**
 * Server setup:
 *   - stdout is reserved for MCP's JSON-RPC frames; every log goes to stderr.
 *   - Tool errors are returned as structured ToolResult with isError=true so
 *     the model can retry, instead of thrown exceptions that crash the transport.
 */

const registry: ToolRegistration[] = [];

function registerTool(tool: Tool, handler: ToolHandler): void {
  if (registry.some((r) => r.tool.name === tool.name)) {
    throw new Error(`Duplicate tool name: ${tool.name}`);
  }
  registry.push({ tool, handler });
}

function log(...args: unknown[]): void {
  console.error("[apple-revcat-mcp]", ...args);
}

async function main(): Promise<void> {
  registerAscTools(registerTool);
  registerRevenueCatTools(registerTool);

  const server = new Server(
    { name: "apple-revcat-mcp", version: "0.2.0" },
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
      log(`Tool ${name} failed:`, message);
      return {
        content: [{ type: "text", text: `Error in ${name}: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`Ready with ${registry.length} tools.`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[apple-revcat-mcp] Fatal:", message);
  process.exit(1);
});
