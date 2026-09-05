# Integração Xphere ↔ Xkedule — Plano de Arquitetura

> **Status:** Plano aprovado nas decisões estruturais. Pendente detalhamento de tarefas executáveis e confirmação dos itens de risco (§8).
> **Repos:** `xphere` (CRM/orquestrador, Next.js 16 + Supabase) · `xkedule` (booking system, Express + Drizzle + Postgres/Supabase).

## 1. Objetivo

Tornar o **Xkedule** (booking system: catálogo de serviços com preço, staff, disponibilidade, agendamentos) uma **capability de plataforma de primeira classe** dentro do **Xphere** (CRM), consumível por três superfícies nativas:

- **Agents** (chat multicanal: web widget, WhatsApp, Instagram, Messenger, ManyChat, Telegram, SMS, Zernio, e voz/Vapi)
- **Workflows** (automações DAG — como nó de ação e como gatilho de evento)
- **Calendário** do Xphere (ver os bookings, timeline do contato, automações `meeting.*`)

## 2. Decisões travadas

| Decisão | Escolha | Implicação |
|---|---|---|
| Fundação de API | **Faseado** | F1 entrega as 3 superfícies funcionando com auth por *shared secret*; F2 endurece com API key real |
| Acesso a dados | **Híbrido** | Catálogo (serviços/preços) sincronizado no KB dos agents; disponibilidade e agendamento sempre ao vivo |
| Direção | **Bidirecional** | Xphere chama o Xkedule (tools) **e** o Xkedule notifica o Xphere (webhooks) |
| Fonte da verdade | **Xkedule canônico + espelho** | A IA sempre cria/edita no Xkedule; o Xphere mantém um booking-espelho read-only |
| Tenancy | **org ↔ tenant 1:1** | Mapeamento e roteamento de webhook simples; porta aberta para 1↔N depois |
| Identidade de contato | **Telefone E.164**, fallback e-mail | Casa com os canais telefônicos/WhatsApp |

## 3. Estado atual

### Já existe e será reaproveitado (Xphere)
- **Calendário nativo**: tabela `bookings`, `event_types`, UI completa em `src/app/(dashboard)/calendar/`, timeline de bookings no perfil do contato.
- **Eventos `meeting.*`** que disparam workflows (`scheduled/confirmed/cancelled/rescheduled/no_show/starts_in/ended`) — emitidos por `src/lib/calendar/transition.ts`, scope em `src/lib/calendar/scope.ts`, cron de 5 min em `src/app/api/cron/calendar-tick/route.ts`.
- **Agents** chamando tools pela mesma `executeAction()` da voz (`src/lib/agent-runtime/run-agent.ts`), com `agent_tools.allowed_channels`.
- **Injeção de KB** no prompt via `kb_scope`.
- **Conector Xkedule meio-construído**: `src/lib/xkedule/` (client + 3 actions), migration `1200_xkedule_integration.sql`, registro em `src/lib/integrations/registry.ts`, plugado em `execute-action.ts`.

### Quebrado / faltando
| Item | Situação |
|---|---|
| `GET /api/services` | 🟡 Conecta, mas lê `basePrice` enquanto serviços `fixed_item` guardam o valor em `price`; e filtra só `showOnLanding=true` |
| Disponibilidade | 🔴 Cliente faz `POST`, servidor expõe `GET`; `totalDurationMinutes` é obrigatório e nunca enviado; nomes divergem (`serviceId`→`serviceIds`, `staffMemberId`→`staffId`) |
| Criar booking | 🔴 Cliente envia `items`, servidor lê `cartItems`; faltam `endTime`/`totalPrice` → rejeitado na validação |
| Auth serviço-a-serviço | 🔴 Endpoints do Xkedule são públicos; "credencial" é só a base URL |
| Rate-limit | ⚠️ `POST /api/bookings` limita 20/10min **por IP** → estrangula o servidor Xphere |
| Webhooks Xkedule→Xphere | 🔴 Não existem (só push write-only de contato em `xphere-sync.ts`) |
| Handler de webhook de entrada no Xphere | 🔴 Trigger `webhook_url` declarado no spec, mas **sem rota** |

## 4. Arquitetura — 3 superfícies

```
                          ┌──────────────────────── XPHERE (CRM) ────────────────────────┐
   Cliente liga /          │                                                               │
   manda WhatsApp  ──────► │  Agent (qualquer canal) ──► tool xkedule_* ──► executeAction  │
                          │                                    │                          │
                          │                                    ▼     (A) Tools            │
                          │                         ┌──────────────────────┐             │
                          │                         │  /api/v1 do Xkedule   │ ◄───────────┼──┐
                          │                         └──────────────────────┘             │  │
                          │                                                               │  │
                          │  POST /api/xkedule/webhook ◄── (C) eventos booking.*          │  │
                          │        │                                                      │  │
                          │        ▼  upsert booking-espelho + link contato               │  │
                          │   tabela bookings ──► emite meeting.* ──► workflows           │  │
                          │   (B) Espelho de calendário     (lembrete, follow-up, etc.)   │  │
                          └───────────────────────────────────────────────────────────────┘  │
                                                                                              │
                          ┌──────────────────────── XKEDULE (Booking) ──────────────────────┐ │
                          │  /api/v1: catalog · availability · bookings (create/cancel/      │ │
                          │           reschedule)   ◄────────────────────────────────────────┼─┘
                          │  Mutação de booking ──► calendarSyncQueue(target xphere_event)   │
                          │                          ──► POST assinado (HMAC) p/ Xphere ──────┼──► (C)
                          └──────────────────────────────────────────────────────────────────┘
```

**Fluxo de ponta a ponta — agendar pela IA:**
1. Agent (qualquer canal) chama `xkedule_check_availability` (ao vivo) e `xkedule_create_booking`.
2. O booking nasce no **Xkedule** (fonte da verdade: staff, duração, preço calculados lá).
3. O Xkedule emite `booking.created` → `POST /api/xkedule/webhook`.
4. O Xphere cria o **booking-espelho**, casa o contato e emite `meeting.scheduled`.
5. Os workflows do usuário reagem (lembrete no canal certo, follow-up, criar oportunidade) — **sem código novo de automação**.

## 5. Contrato de API (o "norte")

### 5.1 Superfície de integração no Xkedule — `/api/v1/*`

Superfície **dedicada e isolada** dos endpoints do frontend. Paths já no formato final (`/api/v1`) para evitar retrabalho; só a **auth** evolui entre fases.

- **Auth F1:** header `X-Xkedule-Key: <shared secret por tenant>`; tenant resolvido pelo host (subdomínio) que o Xphere já armazena.
- **Auth F2:** `Authorization: Bearer xkd_<hex>` com hash em tabela `api_keys`, rate-limit **por key** (não por IP), espelhando o padrão `xph_` do Xphere.

| Método | Path | Entrada | Saída |
|---|---|---|---|
| GET | `/api/v1/catalog` | — | `[{ id, name, description, durationMinutes, pricingType, priceFrom, currency, staff:[{id,name}] }]` |
| GET | `/api/v1/availability` | `?date=YYYY-MM-DD&serviceIds=1,2&staffId=` | `{ slots:[{ time:"14:00", available:true }] }` — **Xkedule deriva `totalDurationMinutes`** da soma das durações dos serviços |
| POST | `/api/v1/bookings` | `{ serviceIds:[], staffMemberId?, bookingDate, startTime, customer:{ name, phone, email?, address? } }` | booking completo `{ id, status, bookingDate, startTime, endTime, totalPrice, … }` — **Xkedule calcula** duração/endTime/preço, cria booking+items+contact |
| POST | `/api/v1/bookings/:id/cancel` | `{ reason? }` | booking atualizado |
| POST | `/api/v1/bookings/:id/reschedule` | `{ bookingDate, startTime, staffMemberId? }` | booking atualizado |
| GET | `/api/v1/bookings/:id` | — | booking completo (para refetch/reconciliação) |

> **Princípio:** o endpoint de booking aceita o **mínimo que a IA consegue coletar numa conversa**; toda a complexidade de cálculo (duração, `endTime`, preço por `pricingType`, frequências) fica no Xkedule, que tem os dados. Não reusar o `POST /api/bookings` do frontend (evita acoplar ao cart client-side e ao rate-limit por IP).

### 5.2 Webhooks Xkedule → Xphere

- **Eventos:** `booking.created` · `booking.updated` · `booking.cancelled` · `booking.rescheduled` · `booking.completed` · `booking.no_show`
- **Destino:** `POST https://xphere.app/api/xkedule/webhook` (URL configurada por tenant)
- **Assinatura:** header `X-Xkedule-Signature: sha256=<hmac(secret, body)>`; header `X-Xkedule-Delivery: <uuid>` para idempotência
- **Entrega:** reusar o `calendarSyncQueue` do Xkedule (já existe para GHL/Google Calendar) com um novo `target = 'xphere_event'`, retry e backoff
- **Payload:**

```json
{
  "event": "booking.created",
  "delivery_id": "uuid",
  "tenant_id": 42,
  "occurred_at": "2026-06-13T17:30:00Z",
  "booking": {
    "id": 123, "status": "confirmed",
    "bookingDate": "2026-06-20", "startTime": "14:00", "endTime": "15:00",
    "timeZone": "America/Sao_Paulo", "totalPrice": "65.00", "currency": "BRL",
    "services": [{ "id": 5, "name": "Corte" }],
    "staff": { "id": 2, "name": "Maria" },
    "customer": { "name": "...", "phone": "+55...", "email": "...", "address": "..." }
  }
}
```

### 5.3 Recepção no Xphere — `POST /api/xkedule/webhook`

Endpoint **dedicado** (não o trigger genérico `webhook_url`), porque o espelho de calendário é **ingestão de dados**, não um workflow. Os workflows reagem *depois*, via os eventos `meeting.*` emitidos.

1. Valida HMAC; deduplica por `delivery_id`.
2. Resolve a **org** pelo mapa tenant→org (ver §5.4).
3. **Upsert** na tabela `bookings` nativa por (`org_id`, `external_source='xkedule'`, `external_id`).
4. Casa/cria o **contato** (telefone E.164 → e-mail → criar) e seta `linked_contact_id`.
5. Emite `meeting.scheduled/confirmed/cancelled/rescheduled/...` (reusar `emitCalendarEvent`). Para `status` pending/awaiting_approval não há upsert em `bookings` (o provider ainda pode rejeitar — ver linha da tabela abaixo); emite-se apenas `meeting.requested`, sem `booking_id` (payload carrega os dados crus do agendamento).

### 5.4 Mapeamento de dados (booking Xkedule → `bookings` Xphere)

| Xkedule | Xphere `bookings` | Observação |
|---|---|---|
| `booking.id` | `external_id` (+ `external_source='xkedule'`) | idempotência |
| `bookingDate`+`startTime` (tz do tenant) | `start_at` (timestamptz/UTC) | **converter** via `timeZone` — ver risco §8 |
| `endTime` | `end_at` | |
| `status` (pending/confirmed/cancelled/completed/no_show) | `status` (confirmed/cancelled/no_show) | mapear; `completed` → status `showed` + evento `meeting.completed`; `pending`/`awaiting_approval` → **sem** upsert em `bookings`, apenas evento `meeting.requested` (payload carrega os campos crus, sem `booking_id`) |
| `customer.*` | `booker_name/email/phone` + `linked_contact_id` | |
| `services[]` | `title`/`notes` + `event_type_id` sintético | criar um `event_type` "Xkedule" por org na conexão (ver risco §8) |
| `staff` | `location_data`/`notes` | sem campo de organizer direto |

### 5.5 Mapa de tenancy (1:1)

Reusar a tabela `integrations` (provider `xkedule`) que já guarda a base URL; adicionar em `config`: `tenant_id` (Xkedule), `webhook_secret`, `shared_secret`. Indexar `config->>'tenant_id'` para o roteamento reverso tenant→org.

## 6. Plano de execução faseado

### Fase 0 — Contrato
- [x] Congelar decisões e shapes (este documento).
- [ ] Revisão final do contrato §5 com o dono.

### Fase 1 — Núcleo funcional (as 3 superfícies)

**Xkedule**
1. Superfície `/api/v1` (catalog · availability com duração derivada · bookings create/cancel/reschedule) + auth shared-secret + resolução de tenant.
2. Emissão de `booking.*` nas mutações → `calendarSyncQueue(target='xphere_event')` + entrega HMAC com retry.
3. Config de webhook por tenant (URL + secret) na UI de integração existente.

**Xphere**
4. Reconciliar `src/lib/xkedule/*` ao contrato §5.1 (corrigir client: `GET` availability, nomes de params, `serviceIds`, preço do catálogo).
5. Registrar nós no `src/lib/workflows/spec.ts` (`integration_required:['xkedule']`) + workflows `kind='tool'` default em `supabase/seeds/workflows/` + anexar a agents (`agent_tools`).
6. `POST /api/xkedule/webhook` (HMAC, resolve org, upsert booking-espelho, link contato, emite `meeting.*`). Migration: `bookings.external_source/external_id` (+ unique parcial) e `event_type` sintético por org.
7. Sync catálogo→KB: GitHub Action agendada (o trigger `schedule` ainda não está ligado a um scheduler) → upsert em `documents` com source dedicada → `kb_scope` do agent.

### Fase 2 — Endurecimento
- API keys reais no Xkedule (`api_keys` hash, `xkd_…`) + rate-limit por key; aposentar o shared secret.
- Reconciliação/backfill periódico (refetch para corrigir drift do espelho).
- Observabilidade: log de entregas de webhook, painel de saúde, rotação de secrets, paginação, idempotência reforçada.
- Suporte a 1 org ↔ N tenants, se necessário.

## 7. Segurança e robustez

- **F1:** shared secret (tools→Xkedule) + HMAC nos webhooks + idempotência (`external_id` e `delivery_id`). Superfície `/api/v1` com rate-limit próprio (não por IP), isolada do `POST /api/bookings` público do frontend.
- **F2:** API keys com hash, rate-limit por key, CORS, versionamento, rotação de secrets.
- **Webhooks de entrada sempre retornam 200** (padrão do Xphere) e processam de forma idempotente.

## 8. Riscos / a confirmar na execução

1. **Fuso horário (crítico).** Bookings do Xkedule são hora local do tenant (`companySettings.timeZone`); `bookings.start_at` do Xphere é timestamptz. A conversão precisa ser explícita e testada.
2. **`event_type_id` no Xphere.** Confirmar se é nullable; senão, criar um `event_type` sintético "Xkedule" por org no momento da conexão.
3. **Campos obrigatórios de `insertBookingSchema`** (`endTime`/`totalPrice`) — confirmar para o endpoint AI-friendly calcular tudo server-side.
4. **Mapeamento de status** `pending`/`awaiting_approval`/`completed` → enum do Xphere (`confirmed/cancelled/no_show`).
5. **Normalização E.164** — país de origem para o telefone (do tenant/`companySettings`).
6. **Runtime serverless do Xkedule (Vercel).** Alguns endpoints têm fallback Supabase (`process.env.VERCEL` em `catalog.ts`); validar a superfície `/api/v1` nesse runtime.
