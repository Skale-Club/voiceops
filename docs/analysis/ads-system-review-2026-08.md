# Análise do Sistema de Ads — Agosto/2026

Auditoria completa do módulo de Ads (Meta + Google) do Xphere: arquitetura atual, pontos fortes, achados priorizados por severidade e roadmap de melhorias.

## 1. Mapa da arquitetura atual

O sistema de Ads é composto por seis subsistemas:

| Subsistema | Onde vive | O que faz |
|---|---|---|
| **Conexões OAuth** | `src/lib/ads/meta-oauth.ts`, `google-oauth.ts`, `/api/ads/{meta,google}/{connect,callback,disconnect}` | Meta: user token long-lived (~60 dias). Google: refresh token (JSON). Tokens AES-256-GCM em `ads_connections`, multi-conta com opt-in (`active`/`available`), CSRF via state cookie, RLS por org. |
| **Dashboard** | `src/app/(dashboard)/ads/*` | Overview (KPIs, funil, tendência diária, top campanhas), painéis de campanhas/adsets/ads, switcher de plataforma, filtro de datas com presets compartilhados, objetivo por conta (leads/sales). |
| **APIs de leitura/mutação** | `/api/ads/meta/reports`, `/api/ads/google/reports`, `/api/ads/meta/campaigns`, `/api/ads/google/campaigns` | Proxy **ao vivo** para Graph API (v26.0) e Google Ads API (v20/GAQL). Mutações: pausar/ativar campanha e alterar orçamento diário em ambas as plataformas. |
| **Atribuição UTM** | `get_ads_attribution` (SQL, SECURITY DEFINER, migrations 1109/1110/1223) + fallback JS (`src/lib/ads/attribution.ts`) + variante MCP | Junta `analytics_sessions → analytics_visitors/analytics_events → contacts → opportunities` e agrega sessões, contatos identificados, oportunidades e receita por UTM. |
| **Ads Journey (camada AI)** | `ads_journey`, `ads_memories`, `ads_plans`, `ads_executions`; `src/lib/ads/journey-db.ts`; tools em `src/lib/copilot/tools/ads.ts` e `src/lib/mcp/tools/ads.ts`; extração de memórias com Haiku (`/api/ads/memories/extract`) | Memória contínua da estratégia: insights, decisões, planos e execuções. Copilot e MCP leem métricas ao vivo, fazem grounding no Global Knowledge (pgvector + ads playbook) e gravam memórias/planos. |
| **Meta CAPI + Custom Audiences** | `src/lib/meta/capi*.ts`, outbox `meta_capi_events`, worker GitHub Actions a cada 5 min; `src/lib/meta/audience-*` | Eventos Lead/QualifiedLead/Purchase server-side com PII hasheada, dedup por `event_id` contra o Pixel, retry/backoff e dead-letter. Audiences com reconcile bem testado. |

## 2. Pontos fortes

- **Segurança bem resolvida**: tokens criptografados (AES-256-GCM), CSRF state cookie no OAuth, RLS em todas as tabelas, mutações validadas com zod (discriminated union), super-admin gating no Global Knowledge.
- **CAPI com padrão outbox**: fila durável, `event_id` determinístico (idempotência + dedup com Pixel browser), backoff exponencial, dead-letter, PII nunca em claro no banco.
- **Camada AI diferenciada**: o conceito de Journey (memórias/planos/execuções) + Global Knowledge com grounding é um diferencial real de produto, bem integrado ao Copilot e ao MCP.
- **Multi-conta com opt-in explícito** (`active`/`available`) preservando escolhas em reconexões.
- **Atribuição SQL já corrigida uma vez** (migration 1110 deduplica por `opp_id`) e sobreviveu ao rename traffic→analytics (1223).

## 3. Achados — severidade ALTA

### A1. Token Meta expira em ~60 dias sem renovação nem alerta
`token_expires_at` é gravado no callback (`/api/ads/meta/callback`) e exposto no MCP, mas **nada verifica a expiração**: não há cron de renovação, alerta ou banner de reconexão. `MetaAdsError` código 190 (token inválido) não transiciona a conexão para `status='error'` nem popula `connection_error`. Resultado: após ~60 dias o dashboard, o Copilot e o fallback do CAPI simplesmente começam a falhar com 502 silenciosos.
**Correção**: cron de expiry-watch (marcar `error` + notificar + banner "Reconectar"); tratar código 190/102 nos handlers marcando a conexão; avaliar System User token (Business Manager) para conexões estáveis — já existe `META_SYSTEM_USER_TOKEN` no worker CAPI.

### A2. Zero cache e zero histórico de insights
Toda visualização do dashboard e toda chamada de tool AI batem **ao vivo** na Graph API / Google Ads API. O overview dispara 4+ chamadas paralelas por render por conta. Consequências: risco de rate-limit da Meta (throttling por ad account), UX lenta, custo de latência nas conversas do Copilot, e **nenhuma série histórica própria** — sem comparativos período-a-período confiáveis, sem dados após desconexão, sem base para alertas de anomalia.
**Correção**: (1) cache curto (60–300s) por org+conta+preset — o Redis já existe em `src/lib/redis.ts`; (2) snapshot noturno `ads_insights_daily` (campanha × dia) via cron, que vira a fonte para tendências, comparativos e alertas.

### A3. Cobertura de testes zero no módulo
`tests/` não tem nenhum teste para rotas de reports, mutações de campanha/orçamento, atribuição, journey ou CAPI enqueue — em contraste com meta-audience (10+ suites). As mutações mexem em **dinheiro** (orçamento diário) e estão sem rede de proteção.
**Correção**: começar por mutações (`/api/ads/meta/campaigns`, `/api/ads/google/campaigns`), enqueue do CAPI e agregação de atribuição (SQL e JS).

### A4. Interpolação sem validação em GAQL (injeção)
`buildGaqlDateCondition` interpola `since`/`until` direto na query (`BETWEEN '${since}' AND '${until}'`) e `listAdGroups` interpola `campaignId` — os três chegam crus de query params em `/api/ads/google/reports`. O raio de dano é limitado ao token da própria org, mas é injeção de query em API autenticada.
**Correção**: validar com zod (`/^\d{4}-\d{2}-\d{2}$/` para datas, `/^\d+$/` para campaignId) antes de montar a GAQL.

### A5. Trilha de auditoria de mutações não está ligada
`recordMutationExecution` (journey-db) existe mas **nunca é chamado** — pausas e mudanças de orçamento feitas pelo dashboard não geram `ads_executions`; `before_value` nunca é capturado. Além disso, qualquer membro autenticado da org pode pausar campanhas e alterar orçamentos: sem gate de papel (RBAC), sem limite máximo, sem confirmação de moeda.
**Correção**: chamar o registro de execução nas rotas de mutação (com before/after), gate por papel admin, e teto configurável de orçamento.

## 4. Achados — severidade MÉDIA

- **M1. Refresh de token Google a cada request** — `gadsRequest` renova o access token em toda chamada; uma página de campanhas gera vários round-trips ao endpoint de token do Google (que tem rate limit). Cachear o access token por ~55 min (Redis/memória).
- **M2. Dupla contagem na atribuição multi-campanha** — uma oportunidade cujo contato teve sessões em N campanhas soma sua receita em N linhas; os totais somam as linhas e **superestimam receita**. O fallback JS (`attribution.ts`) é pior: re-soma as oportunidades a cada sessão do mesmo contato. Definir modelo explícito (last-touch por padrão), dedupe nos totais e documentar.
- **M3. Paginação Meta ignorada** — `listCampaigns/listAdSets/listAds/getInsights` usam `limit=100` e nunca seguem `paging.next`. Contas com >100 campanhas/adsets truncam silenciosamente (joins de insights também ficam incompletos).
- **M4. Moeda hardcoded em "$"/USD** — `snapshot.ts`, títulos de execução no journey (`$X/day`) e tools do Copilot formatam tudo com `$`, embora `currency` da conta seja buscada. Contas BRL exibem símbolo errado (e o Copilot pode raciocinar errado sobre valores).
- **M5. Código morto** — `src/lib/ads/snapshot.ts` (`buildMetaSnapshot`/`buildGoogleSnapshot`, projetado para injetar contexto no system prompt do Copilot) não é importado em lugar nenhum; `recordMutationExecution` idem (ver A5). Ou ligar (ambos são valiosos) ou remover.
- **M6. Seleção implícita de conta na camada AI** — `getMetaAccessToken` do MCP/Copilot aceita contas `available` (não opt-in) e cai na "primeira conexão" quando `ad_account_id` é omitido. Em org multi-conta, o AI pode responder com números da conta errada sem sinalizar. Exigir conta explícita ou usar uma conta default da org, e nunca usar `available`.
- **M7. Paridade Google incompleta na camada AI** — só Meta tem tools de overview/campanhas no Copilot/MCP; o journey aceita `platform='google'` mas o AI não consegue ler métricas Google. Sem equivalente de CAPI para Google (Enhanced Conversions / offline conversion upload com `gclid` — o `fbc`/`fbp` já são capturados, `gclid` não é aproveitado).
- **M8. Observabilidade** — erros engolidos silenciosamente (`catch { return '' }`, `createMemory` retorna `null` sem log), sem Sentry nas rotas de ads, `obs-alerts` não cobre o módulo, `connection_error` nunca é populado fora do reset no callback.

## 5. Achados — severidade BAIXA

- **B1.** `getOrCreateJourney` tem corrida select-then-insert; `ads_journey` tem `UNIQUE(org_id)`, então usar upsert `onConflict: 'org_id'`.
- **B2.** `/api/ads/memories/extract` parseia JSON do modelo com regex; migrar para tool-use estruturado (mais robusto) e mover o modelo para config.
- **B3.** `CHECK (platform IN ('meta','google'))` em `ads_connections` — plataformas futuras (TikTok, LinkedIn) exigem migração; a UI já abstrai via `platform-panel-contract.ts`, o schema não.
- **B4.** Presets não-nativos no Google (`last_3m`, `last_6m`, `last_2y`) silenciosamente viram `LAST_30_DAYS` quando `since/until` não vêm — melhor computar o range no servidor.

## 6. Roadmap sugerido

**Curto prazo (1–2 sprints)** — confiabilidade:
1. Expiry-watcher de token Meta + banner de reconexão + tratamento de erro 190 (A1)
2. Validação zod das datas/ids GAQL (A4)
3. Ligar `recordMutationExecution` + RBAC/limites nas mutações (A5)
4. Cache Redis curto nos reports (parte de A2)
5. Testes das rotas de mutação e do CAPI enqueue (A3)
6. Moeda por conta na formatação (M4)

**Médio prazo (1–2 meses)** — dados próprios:
1. `ads_insights_daily` com snapshot noturno via cron → comparativos período-a-período, gráficos sem latência, base de alertas (A2)
2. Alertas de anomalia ("CPL subiu 40% WoW") via `obs-alerts` ou Workflows
3. Modelo de atribuição explícito + dedupe de totais (M2)
4. Paginação completa Meta (M3), cache de access token Google (M1)
5. Tools Google no Copilot/MCP (M7)
6. Ligar `buildMetaSnapshot`/`buildGoogleSnapshot` no system prompt do Copilot (M5)

**Longo prazo** — produto:
1. Regras automatizadas via sistema unificado de Workflows (`kind='tool'`): "pausar se CPL > X", budget pacing, alertas de spend
2. Google offline conversions com `gclid` (paridade com CAPI)
3. Atribuição multi-touch cruzando `event_id` do CAPI com sessões
4. Insights por criativo (nível `ad` já existe na API interna, falta UI/AI)
5. Abstração de plataforma no schema para TikTok/LinkedIn

---
*Gerado a partir de auditoria do código em `main` (dfde4ac), 2026-08-21.*
