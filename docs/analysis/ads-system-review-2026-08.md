# Análise do Sistema de Ads — Agosto/2026

Auditoria completa do módulo de Ads (Meta + Google) do Xphere: arquitetura, achados priorizados e o que foi corrigido.

> **Status:** todos os 17 achados foram implementados. Ver [seção 7](#7-o-que-foi-implementado) para o mapa achado → correção.

## 1. Mapa da arquitetura

O sistema de Ads é composto por sete subsistemas:

| Subsistema | Onde vive | O que faz |
|---|---|---|
| **Conexões OAuth** | `src/lib/ads/{meta,google}-oauth.ts`, `/api/ads/*/{connect,callback,disconnect}` | Meta: user token long-lived (~60 dias). Google: refresh token. Tokens AES-256-GCM em `ads_connections`, multi-conta com opt-in, CSRF via state cookie, RLS por org. |
| **Saúde de conexão** | `src/lib/ads/connection-health.ts`, `/api/cron/ads-tick` | Detecta credencial morta (Meta 190/102, Google UNAUTHENTICATED), marca `status='error'`, avisa antes da expiração e renderiza banner de reconexão. |
| **Dashboard** | `src/app/(dashboard)/ads/*` | Overview (KPIs, funil, tendência, top campanhas), painéis de campanhas/adsets/ads, switcher de plataforma, filtro de datas, objetivo por conta. |
| **APIs de leitura/mutação** | `/api/ads/{meta,google}/{reports,campaigns}` | Proxy para Graph API v26.0 e Google Ads API v20 (GAQL), com cache Redis curto. Mutações gated por `ads.manage`, com teto de orçamento e trilha de auditoria. |
| **Histórico próprio** | `ads_insights_daily`, `src/lib/ads/snapshot-daily.ts`, cron diário | Captura por campanha × dia com janela retroativa de 7 dias. Base para comparativos período-a-período sem depender da API. |
| **Atribuição UTM** | `get_ads_attribution` (SQL) + `src/lib/ads/attribution.ts` | Single-touch (last_touch padrão, first_touch opcional): cada contato e cada oportunidade é creditado a exatamente uma campanha, então as linhas somam corretamente. |
| **Ads Journey (AI)** | `ads_journey/memories/plans/executions`; tools em Copilot e MCP | Memória contínua da estratégia com grounding no Global Knowledge. Tools Meta **e** Google, resolução explícita de conta, comparação de períodos. |
| **Meta CAPI + Audiences** | `src/lib/meta/capi*`, outbox + worker (5 min) | Lead/QualifiedLead/Purchase server-side, PII hasheada, dedup por `event_id`, retry/backoff, dead-letter. |

## 2. Pontos fortes (mantidos)

- **Segurança**: tokens criptografados, CSRF no OAuth, RLS em todas as tabelas, zod nas mutações, super-admin gating no Global Knowledge.
- **CAPI com padrão outbox**: fila durável, `event_id` determinístico (idempotência + dedup com Pixel), backoff, dead-letter, PII nunca em claro.
- **Camada AI diferenciada**: Journey + Global Knowledge é diferencial real de produto.
- **Multi-conta com opt-in explícito** preservando escolhas em reconexões.

## 3. Achados de severidade ALTA — corrigidos

### A1. Token Meta expirava em ~60 dias sem renovação nem alerta ✅
`token_expires_at` era gravado e nunca lido; o erro 190 virava um 502 genérico com a conexão ainda marcada `active`.
**Correção:** `src/lib/ads/connection-health.ts` classifica erros de auth (Meta 190/102/463/467 + subcodes; Google UNAUTHENTICATED/invalid_grant) e distingue de falhas transitórias (rate limit **não** dispara reconexão). `withConnectionHealth` embrulha toda leitura/mutação. O cron `/api/cron/ads-tick` marca tokens expirados e avisa 7 dias antes. `ConnectionHealthBanner` renderiza o prompt de reconexão — inclusive quando a conta sai do conjunto `active` e a página cairia no estado vazio.

### A2. Zero cache e zero histórico ✅
**Correção:** `src/lib/ads/cache.ts` — cache Redis por org+conta+relatório+janela (120s ao vivo, 900s para janelas fechadas), invalidado após mutação; degrada para fetch direto sem Redis. `ads_insights_daily` (migration 1286) guarda campanha × dia, alimentada pelo cron com janela retroativa de 7 dias (plataformas restatem dias recentes). Dinheiro em `BIGINT` de unidades menores + moeda, nunca float.

### A3. Cobertura de testes zero ✅
**Correção:** 71 testes em 7 suítes — validação/GAQL, presets de data, atribuição, moeda, saúde de conexão, resolução de conta no AI, e as rotas de mutação (RBAC, teto, conversão de moeda, auditoria).

### A4. Interpolação sem validação em GAQL ✅
**Correção:** `src/lib/ads/validation.ts` com `IsoDateSchema` (regex **e** data de calendário real — rejeita `2026-02-31`) e `NumericIdSchema`. Validado nas rotas e reassertado dentro de `google-api.ts`, então a biblioteca é segura independentemente do chamador.

### A5. Trilha de auditoria não estava ligada ✅
**Correção:** `recordMutationExecution` agora é chamado nas duas rotas de mutação com before/after, ator e direção correta (`budget_decrease` em cortes). Gate `ads.manage` via RBAC. Teto de orçamento (`ADS_MAX_DAILY_BUDGET`, padrão 10.000) rejeitando com 422. Coluna `executed_by` (migration 1288).

## 4. Achados de severidade MÉDIA — corrigidos

| # | Achado | Correção |
|---|---|---|
| M1 | Refresh de token Google a cada request | Cache de ~55 min (Redis + fallback em memória); retry único ao receber 401 para não transformar um token revogado cedo em prompt de reconexão. |
| M2 | Dupla contagem na atribuição | Modelo single-touch explícito (migration 1287 + JS). Uma oportunidade de $10k de contato que tocou 3 campanhas agora reporta $10k, não $30k. Coberto por teste. |
| M3 | Paginação ignorada | `graphRequestAll` segue `paging.next` (Meta) e `gaqlSearch` segue `nextPageToken` (Google), com teto de páginas que **loga** quando atingido. |
| M4 | Moeda hardcoded em `$` | `src/lib/ads/currency.ts` com suporte a moedas de zero decimais (JPY/KRW). Toda tool de AI retorna `currency`; o system prompt instrui a nunca assumir dólar. |
| M5 | Código morto (`snapshot.ts`) | Reescrito como comparação período-a-período lendo do histórico novo, e ligado como tool (`compare_ads_periods`) no Copilot e no MCP. |
| M6 | Seleção implícita de conta no AI | `resolveAdAccount` só aceita contas `active`, honra id explícito e devolve a lista quando ambíguo em vez de adivinhar. |
| M7 | Sem paridade Google no AI | `ads_google_get_overview` / `ads_google_list_campaigns` (MCP) e `get_google_ads_overview` / `list_google_ads_campaigns` (Copilot). |
| M8 | Observabilidade | `captureApiError` (Sentry) nas rotas, logs estruturados no cron, e os `catch` silenciosos de `createMemory` / `recordMutationExecution` agora reportam. |

## 5. Achados de severidade BAIXA — corrigidos

- **B1** `getOrCreateJourney` usa upsert `onConflict: 'org_id'` com re-leitura em caso de corrida.
- **B2** Extração de memórias por tool-use estruturado em vez de regex sobre JSON; modelo em `ADS_MEMORY_MODEL`.
- **B3** `platform` aceita `tiktok`/`linkedin`/`microsoft` (migrations 1285/1288).
- **B4** Presets não-nativos do Google resolvidos para intervalo concreto em vez de virarem `LAST_30_DAYS` silenciosamente.

## 6. Operação

**Novo cron — `ads-tick`** (`.github/workflows/ads-tick.yml`, diário 05:10 UTC). Requer os secrets já usados pelos outros ticks (`CRON_SECRET`, `SITE_URL`). Re-execuções são seguras (upsert em chave natural). Disparo manual aceita `org_id` e `skip_snapshot`.

**Nova variável opcional** — `ADS_MAX_DAILY_BUDGET` (padrão 10.000, em unidades maiores da moeda da conta) limita uma única alteração de orçamento diário.

**Migrations — já aplicadas em produção** (projeto `mwklvkmggmsintqcqfvu`): 1285 (saúde de conexão + plataformas), 1286 (`ads_insights_daily`), 1287 (modelo de atribuição), 1288 (ator da execução), 1289 (grants das funções).

> ⚠️ **Drift detectado no banco.** As versões 1283 e 1284 já estavam aplicadas em produção com outros nomes — `medusa_context_atomic_writes` e `commerce_context_v2_binding` — e **não existem em nenhum branch do repositório**. Foram aplicadas direto no banco por outra sessão. Por isso as migrations de Ads foram renumeradas para 1285–1289. Um `supabase db push` a partir de um checkout limpo não reproduz produção enquanto esses dois arquivos não forem versionados; vale recuperá-los do histórico do Supabase.

**Cache** — usa o `REDIS_URL` existente. Sem Redis, tudo continua funcionando (cai direto na API); só se perde o benefício.

## 7. O que foi implementado

**Arquivos novos:** `src/lib/ads/{validation,date-range,cache,connection-health,currency,ai-accounts,snapshot-daily}.ts`, `src/app/api/cron/ads-tick/route.ts`, `src/app/(dashboard)/ads/_components/connection-health-banner.tsx`, 4 migrations, 1 workflow, 7 suítes de teste.

**Reescritos:** `src/lib/ads/{attribution,snapshot}.ts`, as 4 rotas de `/api/ads/{meta,google}/{reports,campaigns}`, `/api/ads/memories/extract`.

**Estendidos:** `meta-api.ts` (paginação, `getCampaign`), `google-api.ts` (paginação, cache de token, validação, `getCampaignSnapshot`), `journey-db.ts`, tools de MCP e Copilot, system prompt, tipos do banco.

## 8. Próximos passos sugeridos

Fora do escopo desta rodada, na ordem em que agregam mais valor:

1. **Alertas de anomalia** — `compare_ads_periods` e `ads_insights_daily` já dão a base; falta a regra ("CPL subiu 40% WoW") e o canal, via `obs-alerts` ou Workflows.
2. **Regras automatizadas** via o sistema unificado de Workflows (`kind='tool'`): pausar se CPL > X, budget pacing.
3. **Google offline conversions** com `gclid` (paridade com o CAPI da Meta) — o `gclid` já chega nas sessões, só não é aproveitado.
4. **Atribuição multi-touch** com crédito fracionado, cruzando `event_id` do CAPI com sessões.
5. **Insights por criativo** — o nível `ad` já existe na API interna, falta UI e tool de AI.
6. **Backfill histórico** — o snapshot só olha 7 dias para trás; um comando único para carregar 90 dias por conta ao ativar.

---
*Auditoria e implementação sobre `main@dfde4ac`, 2026-08-21.*
