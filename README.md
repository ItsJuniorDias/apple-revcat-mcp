# apple-revcat-mcp

MCP server pro Claude Desktop que expõe:

- **App Store Connect API** — apps, sales reports, subscription reports, subscription events, customer reviews, developer responses
- **RevenueCat API v2** — projects, apps, products, entitlements, customers, subscriptions, purchases

Pensado pra indie dev iOS que quer consultar métricas do portfólio direto no chat sem abrir 3 dashboards. Inclui tools de agregação (geo/pricing conversion, cross-app snapshot) pra decisões de campanha e pricing sem parsear TSV na mão.

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
3. Role: `Admin` (recomendado — dá acesso a reviews response) ou `Finance` (mínimo pra sales reports; não permite responder review)
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

### App Store Connect (8 tools)

| Tool | O que faz |
|---|---|
| `asc_list_apps` | Lista apps do dev (id, nome, bundleId, sku, primaryLocale) |
| `asc_get_sales_report` | Baixa qualquer report (SALES / SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER / PRE_ORDER) em TSV. Truncate por linha, header preservado. |
| `asc_get_subscription_events` | Atalho: SUBSCRIPTION_EVENT diário. `reportDate` opcional (default = ontem no fuso Apple, PST). |
| `asc_get_subscription_events_range` ⭐ | Agrega N dias em uma chamada. `daysBack: 14` ou `startDate`/`endDate`. Retorna JSON pronto ou TSV concatenado. |
| `asc_get_geo_conversion_summary` ⭐ | Agrega SUBSCRIPTION_EVENT por país × SKU. Retorna trials, converts, cancels, refunds e conversion rate. **Feito pra validar geo targeting de campanhas ASA.** |
| `asc_list_all_apps_snapshot` ⭐ | One-shot: apps + SALES + SUBSCRIPTION_EVENT de um dia agregados por SKU. Substitui 3 chamadas. |
| `asc_list_customer_reviews` | Reviews recentes, filtro por país. Inclui `developerResponse` (se tu já respondeu). |
| `asc_reply_to_review` ⭐ | Responde review direto do chat. Requer role Admin ou Customer Support na API key. Max 5970 chars. |

### RevenueCat (9 tools)

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
| `rc_get_project_snapshot` ⭐ | apps + products + entitlements + 10 customers recentes em UMA chamada |

⭐ = tools novos na v0.2

---

## 7. Casos de uso comuns

**"Onde vale investir mais em ASA?"**
→ `asc_get_geo_conversion_summary` com `daysBack: 14`. Ordena por trials, olha `conversionRate` por país. País com alto trial mas baixa conversão = LTV baixo ou pricing errado.

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

**RevenueCat 401** — Tá usando public/mobile key ao invés de v2 secret (`sk_...`). Confere o prefixo — o server checa antes de enviar.

**Claude Desktop não vê o server** — Cmd+Q completo? Path absoluto? Rodou `npm run build`? Logs em `~/Library/Logs/Claude/mcp*.log`.

**Debug local**:
```bash
node dist/index.js
```
Se aparecer `[apple-revcat-mcp] Ready with 17 tools.` no stderr, tá tudo ok.

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

- **App Analytics API** — impressions, page views, install source por app. É async (create job → poll → download), então gasta 2-3 chamadas. Útil pra separar orgânico vs ASA.
- **In-App Purchases + Subscriptions metadata** — read/update pricing, intro offers.
- **TestFlight** — builds, testers, feedback.
- **RevenueCat Metrics API** — se/quando expôr MRR/churn no v2 público (hoje só via Charts privado).
