# apple-revcat-mcp

MCP server pro Claude Desktop que expõe:

- **App Store Connect API** — apps, sales reports, subscription reports, subscription events, customer reviews, developer responses
- **App Store Analytics Reports API** — funnel de aquisição (impressions → PPV → downloads) por country × source, sessions, retention, crashes (async pipeline: create request → esperar 24-48h → puxar segments)
- **RevenueCat API v2** — projects, apps, products, entitlements, customers, subscriptions, purchases

Pensado pra indie dev iOS que quer consultar métricas do portfólio direto no chat sem abrir 3 dashboards. Inclui tools de agregação (geo/pricing conversion, cross-app snapshot, engagement funnel) pra decisões de campanha e pricing sem parsear TSV na mão.

**Não inclui Apple Search Ads.** ASA Basic não expõe API — só o dashboard `ads.apple.com`. Se um dia migrar pra Advanced, dá pra adicionar as tools.

---

## 1. Pré-requisitos

- Node.js **20+**
- Claude Desktop (macOS)
- Uma API Key do App Store Connect (`.p8`)
- Uma secret key v2 do RevenueCat (`sk_...`)

---

## 2. Gerar credenciais

### App Store Connect

1. Vai em **App Store Connect → Users and Access → Integrations → App Store Connect API**
2. Clica em **Generate API Key**
3. Role: `Admin` (recomendado — cobre tudo, incluindo reviews response e o primeiro create do Analytics Report Request) ou `Finance` / `Sales and Reports` (mínimo pra sales reports; não permite responder review NEM criar Analytics Report Request pela primeira vez)
4. Anota:
   - **Issuer ID** (topo da página, formato UUID)
   - **Key ID** (10 caracteres, ex: `AB12CD34EF`)
5. Baixa o `.p8` — **só dá pra baixar uma vez**, guarda com carinho

Também precisa do **Vendor Number**: **App Store Connect → Payments and Financial Reports** → topo da página.

### RevenueCat

1. **RevenueCat Dashboard → Project Settings → API Keys**
2. Cria uma **v2 Secret API Key** (começa com `sk_`) — ⚠️ não usa public/mobile key
3. **Project ID**: fica na URL, em `app.revenuecat.com/projects/{ESSE_ID}`. Se tu tem vários projects, deixa `RC_DEFAULT_PROJECT_ID` vazio e passa o id nas chamadas.

---

## 3. Instalar

```bash
cd apple-revcat-mcp
npm install
npm run build
```

Coloca o `.p8` numa pasta ignorada pelo git:

```bash
mkdir -p keys
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 keys/
```

O `.gitignore` já bloqueia `keys/` E `*.p8` em qualquer lugar — não vai commitar sem querer.

---

## 4. Configurar no Claude Desktop

Edita `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Fecha o Claude Desktop **completamente** (`Cmd+Q`) e abre de novo.

---

## 4b. Alternativa: modo HTTP (claude.ai web/mobile)

O passo 4 acima cobre **stdio** (Claude Desktop). Se tu quiser plugar o
MCP no **claude.ai web/mobile** ou usar como custom connector qualquer,
precisa rodar em modo **Streamable HTTP** e expor a porta via túnel
(cloudflared / ngrok) ou host próprio.

```bash
# 1. Copia o .env
cp .env.example .env

# 2. Preenche credenciais do ASC/RC + gera um bearer token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → cola no MCP_AUTH_TOKEN= dentro de .env

# 3. Sobe o servidor
npm run build
npm run start:http
# → HTTP transport listening on http://127.0.0.1:3333/mcp

# 4. Em outra aba, sobe o túnel
cloudflared tunnel --url http://localhost:3333
# → https://<random>.trycloudflare.com
```

Depois no claude.ai: **Settings → Connectors → +Add custom connector**,
cola `https://<random>.trycloudflare.com/mcp`, e em **Advanced settings
→ Request headers** adiciona header `Authorization` com valor
`Bearer <MCP_AUTH_TOKEN>`.

Detalhes completos, health check, e troubleshooting em
[`claude_web_connector.example.md`](./claude_web_connector.example.md).

**Notas:**
- Os dois modos (stdio + HTTP) coexistem: mesma build, entrypoints
  diferentes (`dist/index.js` vs `dist/http.js`). Tu pode ter os dois
  rodando em paralelo.
- Modo HTTP é **stateless** — cada request cria server + transport
  novos. Sem persistência, sem session ID.
- **Auth é obrigatório**: se `MCP_AUTH_TOKEN` não estiver setado ou
  tiver menos de 16 chars, o servidor recusa subir. Túnel público sem
  auth = suas chaves ASC/RC expostas.
- Credenciais ASC/RC **não trafegam pelo túnel** — o Claude.ai só manda
  chamadas MCP; a autenticação com Apple/RevenueCat sai do teu processo
  local direto.

---

## 5. Testar

No Claude Desktop:

- "Lista meus apps no App Store Connect"
- "Quantos trials começaram ontem?"
- "Me dá um resumo de conversão dos últimos 14 dias por país"
- "Snapshot cross-app de ontem"
- "Lista meus projects no RevenueCat"
- "Snapshot do project {id}"
- "Reviews recentes do app {id}, incluindo minhas respostas"

Um ícone 🔨 aparece no chat quando ele chama uma tool.

---

## 6. Tools disponíveis

### App Store Connect — Sales & Reviews (8 tools)

| Tool | O que faz |
|---|---|
| `asc_list_apps` | Lista apps do dev (id, nome, bundleId, sku, primaryLocale) |
| `asc_get_sales_report` | Baixa qualquer report (SALES / SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER / PRE_ORDER) em TSV. Truncate por linha, header preservado. |
| `asc_get_subscription_events` | Atalho: SUBSCRIPTION_EVENT diário. `reportDate` opcional (default = ontem no fuso Apple, PST). |
| `asc_get_subscription_events_range` | Agrega N dias em uma chamada. `daysBack: 14` ou `startDate`/`endDate`. Retorna JSON pronto ou TSV concatenado. |
| `asc_get_geo_conversion_summary` | Agrega SUBSCRIPTION_EVENT por país × SKU. Retorna trials, converts, cancels, refunds e conversion rate. **Feito pra validar geo targeting de campanhas ASA.** |
| `asc_list_all_apps_snapshot` | One-shot: apps + SALES + SUBSCRIPTION_EVENT de um dia agregados por SKU. Substitui 3 chamadas. |
| `asc_list_customer_reviews` | Reviews recentes, filtro por país. Inclui `developerResponse` (se tu já respondeu). |
| `asc_reply_to_review` | Responde review direto do chat. Requer role Admin ou Customer Support na API key. Max 5970 chars. |

### App Store Analytics Reports API (6 tools) 🆕 v0.3

Pipeline assíncrono: cria um report request → espera 24-48h → puxa reports/instances/segments → parse TSV. Distinto do Sales Report acima — traz **funnel de aquisição** (impressions, product page views, downloads by source × country), sessions/retention/crashes, uso de frameworks e performance. Categorias: `APP_STORE_ENGAGEMENT`, `APP_USAGE`, `COMMERCE`, `FRAMEWORKS_USAGE`, `PERFORMANCE`.

| Tool | O que faz |
|---|---|
| `asc_list_analytics_report_requests` | Lista requests já criados pro app. `accessType` = ONGOING (diário/semanal/mensal recorrente) ou ONE_TIME_SNAPSHOT (dump histórico). Sinaliza `stoppedDueToInactivity` (Apple pausa se ninguém puxa por muito tempo). |
| `asc_create_analytics_report_request` | Cria request novo. **Primeira criação exige role Admin.** Primeiros dados chegam 24-48h depois. |
| `asc_list_analytics_reports` | Dado um request, lista os reports disponíveis por category (ex: "App Store Discovery and Engagement Standard"). |
| `asc_list_analytics_report_instances` | Dado um report, lista instâncias (uma por processingDate × granularity). Filtro `processingDate: YYYY-MM-DD` pra bater num dia específico. |
| `asc_get_analytics_report_segments` | Baixa TODOS os segments de uma instância em paralelo, junta o TSV (com deduplicação de header) e retorna JSON parseado com colunas + rows, ou TSV bruto. |
| `asc_get_engagement_funnel` ⭐ | **Wrapper high-level.** Dado `appId` e `daysBack`, resolve tudo automagicamente: acha o report de engagement, puxa instances diárias, baixa segments, e agrega **funnel (impressions → PPV → downloads → conversion rate) por Territory × Source Type**. Isso é o que tu quer pra otimizar ASA / entender orgânico vs pago. |

### RevenueCat v2 (9 tools)

| Tool | O que faz |
|---|---|
| `rc_list_projects` | Lista projects da conta |
| `rc_list_apps` | Apps de um project |
| `rc_list_products` | SKUs configurados (paginação) |
| `rc_list_entitlements` | Entitlements |
| `rc_list_customers` | Lista customers (paginação via `starting_after`) |
| `rc_get_customer` | Detalhe de um customer por `app_user_id` |
| `rc_get_customer_subscriptions` | Subs ativas/expiradas |
| `rc_get_customer_purchases` | Transactions |
| `rc_get_project_snapshot` | apps + products + entitlements + 10 customers recentes em UMA chamada |

⭐ = wrapper high-level, sempre a primeira escolha antes de descer pra tools de baixo nível.

---

## 7. Casos de uso comuns

**"Onde vale investir mais em ASA?"**
→ `asc_get_geo_conversion_summary` com `daysBack: 14`. Ordena por trials, olha `conversionRate` por país. País com alto trial mas baixa conversão = LTV baixo ou pricing errado.

**"ASA tá ganhando auction? Onde meu app aparece pra usuário?"**
→ `asc_get_engagement_funnel` com `daysBack: 7`. Cruza impressions × PPV × downloads por Territory × Source Type. Se impressions em Search estão altas mas PPV baixo = teu creative/screenshot não atrai. Se PPV alto mas downloads baixo = preço, screenshots ou descrição travam a conversão. Pré-requisito: `asc_create_analytics_report_request` com `accessType: ONGOING` (uma vez, com Admin key), esperar 24-48h. Depois roda quanto quiser.

**"Cross-app comparação rápida"**
→ `asc_list_all_apps_snapshot`. Se algum app zerou downloads ou trials, vai aparecer óbvio.

**"O que aconteceu na semana passada?"**
→ `asc_get_subscription_events_range` com `daysBack: 7`. Depois pergunta pro modelo agregar do jeito que tu quer.

**"Reviews ruins pra responder"**
→ `asc_list_customer_reviews` filtrado por `territory` + `includeDeveloperResponse: true`. Filtra 1-2 stars sem resposta, depois `asc_reply_to_review`.

---

## 8. Troubleshooting

**"ASC_PRIVATE_KEY_PATH is not set"** — path errado ou `~/` no config. Usa caminho absoluto.

**"File at X does not look like a PKCS8 PEM"** — path aponta pro arquivo errado, ou o `.p8` foi corrompido no download. Re-baixa do ASC.

**HTTP 401 do App Store Connect** — Key ID ou Issuer ID errado, ou o `.p8` não corresponde. Confere as 3 coisas.

**HTTP 403 no `asc_reply_to_review`** — API key não tem role suficiente. Precisa Admin ou Customer Support.

**HTTP 404 nos sales reports** — Date muito recente (Apple tem ~1 dia de lag) OU vendor number errado OU não tem dados naquele dia. Tenta 2 dias atrás.

**"Report not found" em datas antigas** — Weekly report precisa ser um **domingo**. Monthly é `YYYY-MM`, yearly é `YYYY`.

**`asc_get_engagement_funnel` retorna `status: "no_report_request"`** — nunca criou um Analytics Report Request pra esse app. Roda `asc_create_analytics_report_request` com `accessType: ONGOING` uma vez (precisa Admin key na primeira vez pra cada app) e espera 24-48h. Depois `asc_get_engagement_funnel` responde direto.

**`asc_get_engagement_funnel` retorna `status: "created_wait_for_data"`** — tu passou `autoCreate: true` e o request acabou de ser criado. Espera 24-48h e tenta de novo.

**Instances vazias (`rowCount: 0`) em dias recentes** — Apple tem lag de 24-48h pra publicar o primeiro report ONGOING e depois +2 dias pra dados serem considerados completos. Pra dados de "ontem" ou "hoje" é normal vir vazio; tenta 3-4 dias atrás.

**403 em `asc_create_analytics_report_request`** — a key não tem role Admin. Primeira criação por app exige Admin; depois disso, Sales-and-Reports ou Finance conseguem ler.

**Request em `stoppedDueToInactivity: true`** — Apple pausou porque ninguém consumiu por muito tempo. Cria um novo com `asc_create_analytics_report_request`.

**RevenueCat 401** — Tá usando public/mobile key ao invés de v2 secret (`sk_...`). Confere o prefixo — o server checa antes de enviar.

**Claude Desktop não vê o server** — Cmd+Q completo? Path absoluto? Rodou `npm run build`? Logs em `~/Library/Logs/Claude/mcp*.log`.

**Debug local**:
```bash
node dist/index.js
```
Se aparecer `[apple-revcat-mcp] Ready with 23 tools.` no stderr, tá tudo ok.

---

## 9. Segurança

- O `.p8` é a chave privada da tua conta Apple — **nunca** commita. O `.gitignore` bloqueia `*.p8` e `keys/`. Se vazar, revoga IMEDIATAMENTE em ASC → Users and Access → Integrations.
- A secret key do RevenueCat dá read completo — trata como senha.
- Se já commitou uma `.p8` sem querer, **remover do último commit não basta** — precisa reescrever o histórico:
  ```bash
  # revoga a key primeiro no dashboard, depois:
  git filter-repo --path AuthKey_XXX.p8 --invert-paths
  git push --force
  ```

---

## 10. Próximos passos possíveis

- **Wrappers pra App Usage e Performance** — no mesmo padrão do `asc_get_engagement_funnel`, mas pras categorias `APP_USAGE` (sessions, retention, uninstalls) e `PERFORMANCE` (crashes por versão). Toda a plumbaria assíncrona (create → instances → segments) já tá pronta em `src/asc/analytics.ts`; só falta a agregação específica de cada dataset.
- **In-App Purchases + Subscriptions metadata** — read/update pricing, intro offers.
- **TestFlight** — builds, testers, feedback.
- **RevenueCat Metrics API** — se/quando expôr MRR/churn no v2 público (hoje só via Charts privado).
