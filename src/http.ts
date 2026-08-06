#!/usr/bin/env node
/**
 * HTTP entry point (Streamable HTTP transport).
 *
 * Used by claude.ai custom connectors, either directly (if you host this
 * behind a public HTTPS URL) or via a tunnel (cloudflared / ngrok pointed
 * at the local port).
 *
 * Runs in STATELESS mode: every incoming POST /mcp gets a brand-new Server
 * + Transport pair. No session state, no cross-request coupling. Simpler
 * to reason about and matches how claude.ai currently drives connectors.
 *
 * Auth is a shared bearer token (MCP_AUTH_TOKEN in env). The token MUST be
 * sent by the client on every request as either:
 *   - Authorization: Bearer <token>
 *   - x-mcp-auth-token: <token>
 *
 * Set MCP_AUTH_TOKEN to something you can copy into claude.ai's connector
 * request headers UI. If MCP_AUTH_TOKEN is missing, the server refuses to
 * start — no unauth mode. Your ASC + RevenueCat keys are too sensitive to
 * expose behind an open tunnel.
 */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, logError } from "./server.js";

const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? "127.0.0.1";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!AUTH_TOKEN || AUTH_TOKEN.length < 16) {
  console.error(
    "[apple-revcat-mcp] MCP_AUTH_TOKEN missing or too short (< 16 chars). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
  process.exit(1);
}

/** Constant-time-ish comparison to reduce timing-attack surface. */
function tokensMatch(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < candidate.length; i++) {
    mismatch |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

function extractToken(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const custom = req.header("x-mcp-auth-token");
  if (custom) return custom.trim();
  return undefined;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!tokensMatch(token, AUTH_TOKEN as string)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  next();
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "apple-revcat-mcp", mode: "http" });
});

// MCP endpoint. Stateless: new Server + Transport per request.
app.post("/mcp", requireAuth, async (req, res) => {
  try {
    const { server } = createServer();
    const transport = new StreamableHTTPServerTransport({
      // sessionIdGenerator: undefined => stateless mode
      sessionIdGenerator: undefined,
    });

    // Clean up when the underlying connection ends.
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logError("HTTP /mcp error:", message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: `Internal error: ${message}` },
        id: null,
      });
    }
  }
});

// GET/DELETE /mcp are used by the SSE stream side of Streamable HTTP.
// In stateless mode we don't need them, so return 405.
const methodNotAllowed = (_req: Request, res: Response): void => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless mode)." },
    id: null,
  });
};
app.get("/mcp", requireAuth, methodNotAllowed);
app.delete("/mcp", requireAuth, methodNotAllowed);

app.listen(PORT, HOST, () => {
  logError(`HTTP transport listening on http://${HOST}:${PORT}/mcp`);
  logError(
    `Health check: curl http://${HOST}:${PORT}/health   (no auth required)`
  );
});
