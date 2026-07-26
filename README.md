# apple-revcat-mcp

MCP server pro Claude Desktop que expõe:

- **App Store Connect API** — lista de apps, sales reports, subscription reports, subscription events, customer reviews
- **RevenueCat API v2** — projects, apps, products, entitlements, customers, subscriptions, purchases

Pensado pra indie dev iOS que quer consultar métricas do portfólio direto no chat sem abrir 3 dashboards.

**Não inclui Apple Search Ads.** ASA Basic não expõe API — só o dashboard `ads.apple.com`. Se um dia migrar pra Advanced, dá pra adicionar as tools.

---

## 1. Pré-requisitos

- Node.js **20+**
- Claude Desktop (macOS)
- Uma API Key do App Store Connect (`.p8`)
- Uma secret key v2 do RevenueCat

---

## 2. Gerar credenciais

### App Store Connect

1. Vai em **App Store Connect → Users and Access → Integrations → App Store Connect API**
2. Clica em **Generate API Key** (ou usa uma existente)
3. Role: `Admin` ou `Finance` (Finance é o mínimo pra sales reports)
4. Anota:
   - **Issuer ID** (fica no topo, formato UUID)
   - **Key ID** (10 caracteres, ex: `AB12CD34EF`)
5. Baixa o `.p8` — **só dá pra baixar uma vez**, guarda com carinho

Também precisa do **Vendor Number**:

- **App Store Connect → Payments and Financial Reports** → topo da página

### RevenueCat

1. Vai em **RevenueCat Dashboard → Project Settings → API Keys**
2. Cria uma **v2 Secret API Key** (começa com `sk_`)
   - ⚠️ Não usa a public/mobile key aqui — não tem permissão pra ler dados de outros customers
3. Pega o **Project ID** na URL: `app.revenuecat.com/projects/{ESSE_ID}`
   - Se tu tem vários projects (Pedagogy, Magic World, StoryBox…), deixa `RC_DEFAULT_PROJECT_ID` vazio e passa o id nas chamadas, OU roda o server duas vezes com envs diferentes

---

## 3. Instalar e buildar

```bash
cd apple-revcat-mcp
npm install
npm run build
```

Coloca o `.p8` numa pasta (recomendo criar `./keys/`):

```bash
mkdir -p keys
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 keys/
```

---

## 4. Configurar no Claude Desktop

Edita `~/Library/Application Support/Claude/claude_desktop_config.json` (cria se não existir) e adiciona:

```json
{
  "mcpServers": {
    "apple-revcat": {
      "command": "node",
      "args": ["/CAMINHO/ABSOLUTO/apple-revcat-mcp/dist/index.js"],
      "env": {
        "ASC_KEY_ID": "AB12CD34EF",
        "ASC_ISSUER_ID": "00000000-0000-0000-0000-000000000000",
        "ASC_PRIVATE_KEY_PATH": "/CAMINHO/ABSOLUTO/apple-revcat-mcp/keys/AuthKey_AB12CD34EF.p8",
        "ASC_VENDOR_NUMBER": "12345678",
        "RC_SECRET_KEY": "sk_XXXXXXXXXXXXXXXXXXXXXXXX",
        "RC_DEFAULT_PROJECT_ID": ""
      }
    }
  }
}
```

Substitui `/CAMINHO/ABSOLUTO/` pelo path real. Não usa `~/` — Claude Desktop não expande.

Fecha o Claude Desktop **completamente** (`Cmd+Q`, não só fechar janela) e abre de novo.

---

## 5. Testar

No Claude Desktop, tenta:

- "Lista meus apps no App Store Connect"
- "Quantos trials começaram ontem no vendor XXX?" (formato date `YYYY-MM-DD`)
- "Baixa o SUBSCRIPTION_EVENT report de ontem"
- "Lista meus projects no RevenueCat"
- "Me mostra os últimos 20 customers do project {id}"
- "Detalha o customer {app_user_id}"

Um ícone de tool 🔨 vai aparecer no chat quando ele usar as functions.

---

## 6. Tools disponíveis

### App Store Connect

| Tool | O que faz |
|---|---|
| `asc_list_apps` | Lista apps do dev (id, nome, bundleId, sku) |
| `asc_get_sales_report` | Baixa qualquer report (SALES / SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER / PRE_ORDER) em TSV |
| `asc_get_subscription_events` | Atalho: SUBSCRIPTION_EVENT diário (trial starts, converts, cancels) |
| `asc_list_customer_reviews` | Reviews recentes de um app, filtro por país |

### RevenueCat

| Tool | O que faz |
|---|---|
| `rc_list_projects` | Lista projects da tua conta |
| `rc_list_apps` | Apps de um project |
| `rc_list_products` | SKUs configurados |
| `rc_list_entitlements` | Entitlements |
| `rc_list_customers` | Lista customers (paginação via `starting_after`) |
| `rc_get_customer` | Detalhe de um customer por `app_user_id` |
| `rc_get_customer_subscriptions` | Subs ativas/expiradas de um customer |
| `rc_get_customer_purchases` | Transactions de um customer |

---

## 7. Troubleshooting

**"ASC_PRIVATE_KEY_PATH is not set"**
→ Path errado ou tem `~/` no config. Usa caminho absoluto.

**HTTP 401 do App Store Connect**
→ JWT tá inválido. Confere Key ID, Issuer ID e se o `.p8` corresponde. Também verifica se a key tem role suficiente (Finance mínimo pra sales reports).

**HTTP 404 nos sales reports**
→ Date muito recente (Apple tem ~1 dia de lag) OU vendor number errado OU não tem dados naquele dia. Tenta 2 dias atrás.

**"Report not found" mesmo em datas antigas**
→ Weekly report precisa ser um **domingo**. Monthly é `YYYY-MM`, yearly é `YYYY`.

**RevenueCat 401**
→ Tá usando public/mobile key ao invés da secret v2 (`sk_...`).

**Claude Desktop não vê o server**
→ Deu Cmd+Q completo? Path absoluto correto? Rodou `npm run build`? Vê os logs em `~/Library/Logs/Claude/mcp*.log`.

**Debug local:**
```bash
node dist/index.js
```
Se aparecer `[apple-revcat-mcp] Ready with N tools.` no stderr e o processo ficar rodando, tá tudo ok (ele espera JSON-RPC no stdin).

---

## 8. Segurança

- O `.p8` é a chave privada da tua conta Apple — **nunca** commita
- A secret key do RevenueCat dá read completo — trata como senha
- `.gitignore` já bloqueia `keys/*.p8` e `.env`
- Se vazar, revoga imediatamente e gera nova

---

## 9. Próximos passos possíveis

Se tu quiser expandir depois:

- **App Analytics API** (nova) — impressions, page views, source de install por app. Requer request assíncrono (cria job → poll → download)
- **In-App Purchases + Subscriptions metadata** — read/update pricing, intro offers
- **TestFlight** — builds, testers, feedback
- **RevenueCat Overview/MRR** — RevenueCat v2 não expõe MRR direto via REST público; pra isso tem que somar do lado do server ou usar Charts privados
- **Sentry / PostHog** — adicionar outros MCPs conectados
