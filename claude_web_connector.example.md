# Plugging into claude.ai (custom connector)

This is the HTTP-mode counterpart of `claude_desktop_config.example.json`.
Follow these steps once you have `npm run start:http` running locally and a
tunnel URL from cloudflared or ngrok.

## 1. Copy `.env.example` to `.env` and fill in credentials

```bash
cp .env.example .env
# edit .env — ASC keys, RC key, and generate MCP_AUTH_TOKEN
```

Generate the shared token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `MCP_AUTH_TOKEN=` in `.env`. Keep a copy — you'll
also paste it into claude.ai.

## 2. Build and start the HTTP server

```bash
npm install
npm run build
npm run start:http
# → HTTP transport listening on http://127.0.0.1:3333/mcp
```

Sanity check (no auth required for /health):

```bash
curl http://127.0.0.1:3333/health
# → {"ok":true,"service":"apple-revcat-mcp","mode":"http"}
```

Auth check (should return 200 with an initialize response OR a JSON-RPC
error, but never a 401 if the token is right):

```bash
curl -X POST http://127.0.0.1:3333/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## 3. Expose the port with a tunnel

Pick one:

```bash
# Cloudflare quick tunnel (URL changes every restart)
cloudflared tunnel --url http://localhost:3333
```

```bash
# ngrok
ngrok http 3333
```

Copy the public HTTPS URL, e.g.:
`https://travelers-demand-goal-jewellery.trycloudflare.com`

## 4. Add the connector in claude.ai

1. Open <https://claude.ai/settings/connectors>.
2. Click **+** → **Add custom connector**.
3. Fields:
   - **Name**: `apple-revcat-mcp`
   - **Remote MCP server URL**: `https://<your-tunnel>/mcp`
     (note the trailing `/mcp`)
4. Open **Advanced settings** → **Request headers**:
   - Header name: `Authorization`
   - Value: `Bearer <the same MCP_AUTH_TOKEN from .env>`
5. Click **Add**, then **Connect**.

## 5. Enable per conversation

In a new chat, click the **+** in the composer → **Connectors** → toggle
`apple-revcat-mcp` on. You should now see the ASC + RevenueCat tools in
the tool list.

## Notes

- **Stateless mode**: every request creates a fresh Server + Transport.
  Cheap on the local machine; no session cleanup needed.
- **Credentials never leave your machine**: the tunnel forwards MCP calls
  to your local process, which authenticates directly with Apple / RC
  from your IP. Only the shared `MCP_AUTH_TOKEN` needs to be trusted to
  claude.ai.
- **Free-tier tunnels rotate URLs**: cloudflared Quick Tunnel and ngrok
  Free both give you a new subdomain on restart. To keep a fixed URL,
  set up a Cloudflare named tunnel or ngrok reserved domain (both free
  with an account).
- **Mobile app**: you can't *add* custom connectors from the mobile app,
  but once added on the web, the connector is available on iOS/Android
  too. Enable it per conversation from the composer.
