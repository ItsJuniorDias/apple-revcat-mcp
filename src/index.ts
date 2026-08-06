#!/usr/bin/env node
/**
 * Stdio entry point.
 *
 * Used by Claude Desktop via claude_desktop_config.json:
 *   { "command": "node", "args": [".../dist/index.js"], "env": {...} }
 *
 * For the HTTP entry (used by claude.ai custom connectors + tunnels),
 * see src/http.ts and run `npm run start:http`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, logError } from "./server.js";

// Re-export shared types so existing imports from "../index.js" keep working
// in src/asc/tools.ts, src/revenuecat/tools.ts, and src/utils/tool.ts.
export type { ToolResult, ToolHandler } from "./server.js";

async function main(): Promise<void> {
  const { server, toolCount } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logError(`stdio ready with ${toolCount} tools.`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[apple-revcat-mcp] Fatal:", message);
  process.exit(1);
});
