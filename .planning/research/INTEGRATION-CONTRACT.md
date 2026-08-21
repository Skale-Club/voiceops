# Stuscle ⇄ Xphere Integration Contract

**Status: FROZEN v2** (§3 commerce context token bumped v1→v2 — see `stuscle/docs/INTEGRATION-XPHERE-X2-TOKEN-BINDING.md`) — this document is the single source of truth for the integration between the Stuscle e-commerce (Medusa 2.17 backend + Next.js 15 storefront, repo `C:\Users\Vanildo\Dev\stuscle`) and the Xphere CRM (Next.js + Supabase, repo `C:\Users\Vanildo\Dev\xphere`). Both sides are planned and built against this contract. Any change to a payload, header, or endpoint here requires updating this file first, in both repos' copies (`.planning/research/INTEGRATION-CONTRACT.md`).

## 1. Overview

The Xphere webchat widget is embedded on the Stuscle storefront. The Xphere AI agent gets commerce tools so it can, on behalf of the visitor currently chatting: search/recommend products, read and modify the visitor's **real** cart, manage a wishlist, and report order status (logged-in customers only). Medusa pushes commerce events (order placed, customer created) back to Xphere so CRM workflows can react.

```
storefront (:8000) ── mounts widget + GET /api/chat-context (mints signed context
   │                   token reading httpOnly cookies _medusa_cart_id/_medusa_jwt)
   │  widget POST {xphere}/api/chat/{widget_token} { message, sessionId, pageUrl,
   │                                                commerce_context }
xphere (:3000) ── verifies HMAC → PINS cart/customer on the conversation
   │              agent tools medusa_* (action_type enum) → HTTP → Medusa
   │              SSE additions: {event:'commerce',...} {event:'ui', product_cards}
   │  ◄── POST /api/v1/commerce/events  (Bearer xph_..., scope commerce:events)
Medusa backend (:9000) ── wishlist module + /agent/* routes (HMAC) +
                          subscribers (order.placed, customer.created) → xphere
```

## 2. Secrets & auth model

**One connection secret** (`XPHERE_CONNECTION_TOKEN`): a real Xphere API key `xph_...` created with the new scope `commerce:events`. It lives in three places:

| Where | Form | Used for |
|---|---|---|
| Xphere `api_keys` table | SHA-256 hash | Authenticates Medusa→Xphere event webhooks (`verifyApiKey`, scope `commerce:events`) |
| Xphere `integrations` row (`provider='medusa'`) | AES-256-GCM in `encrypted_api_key` | HMAC key to (a) verify storefront-minted context tokens, (b) sign xphere→Medusa `/agent/*` calls, (c) sign `cart_created` adoption sigs |
| Stuscle env `XPHERE_CONNECTION_TOKEN` (backend `.env` + storefront `.env.local`) | plaintext env | Storefront signs context tokens; backend verifies `/agent/*` HMAC and sends Bearer on webhooks |

Additional per-org Xphere integration config (`integrations.config` JSONB): `{ "publishable_key": "pk_...", "storefront_url": "http://localhost:8000", "default_region_id": "reg_..." (optional cache) }`. `integrations.location_id` stores the Medusa base URL (e.g. `http://localhost:9000`).

Rotation: rotating the `xph_` key rotates every trust relationship at once — update the integration row and both Stuscle envs together.

## 3. Commerce context token (storefront → widget → xphere)

**Status: v2** (bumped from v1 — see `docs/INTEGRATION-XPHERE-X2-TOKEN-BINDING.md` for the full design rationale). v1 tokens are rejected outright; there is no transition window because the integration was not yet wired/in production when the bump landed.

Compact HMAC blob (no JWT lib): `token = base64url(payloadJson) + "." + base64url(HMAC_SHA256(XPHERE_CONNECTION_TOKEN, base64url(payloadJson)))`. The signature covers the base64url payload **string** — Xphere verifies by recomputing the HMAC over the received string, it never re-serializes the JSON, so adding claim fields (as v2 does) needs no change to the signing bytes.

Payload claims:

```jsonc
{
  "v": 2,                            // was 1
  "org": "<xphere org uuid>",        // from env XPHERE_ORG_ID; xphere checks it matches the widget token's org
  "cart": "cart_01H..." | null,      // from httpOnly _medusa_cart_id cookie
  "cus": "cus_01H..." | null,        // ONLY after server-side verification of _medusa_jwt via GET /store/customers/me
  "email": "x@y.com" | null,         // ONLY from the verified customer object — never from user input
  "wishlist_ref": "<uuid>" | null,   // guest wishlist key (httpOnly cookie _wishlist_ref)
  "country_code": "dk",
  "region_id": "reg_01..." | null,
  "jti": "<uuid>",                   // NEW v2 — one-time use; consumed server-side on pin (replay rejected)
  "cnonce": "<uuid>",                // NEW v2 — client-generated (widget, in-memory, per page load); binds the token to one conversation
  "iat": 1750000000,
  "exp": 1750000300                  // iat + 300 (was +900 — 5 min TTL)
}
```

- **Minting**: `GET /api/chat-context` on the storefront (same-origin only — reject cross-origin `Sec-Fetch-Site`/Origin; IP rate limit 30/min). Reads `cnonce` from `?cnonce=` on the request (opaque id, ≤64 chars, `/^[A-Za-z0-9_-]+$/`); absent/invalid → the storefront generates a server-side fallback (`crypto.randomUUID()`) so a direct curl mint still works. Generates a fresh `jti = crypto.randomUUID()` per mint. Response: `{ "token": "<payload>.<sig>" }`. Never decode-and-trust the JWT: `cus`/`email` are emitted only after a live `/store/customers/me` check.
- **Widget**: reads `data-context-endpoint` from its script tag; generates one `cnonce` (UUID) per page load, held in memory only (never localStorage), and appends it as `?cnonce=` on every mint request; fetches a token lazily (on first message, and re-fetches when `exp` passed or after a `cart_created` event — the shorter 300s TTL needs no extra widget logic, the existing exp-based re-fetch already covers it); sends the token as `commerce_context` in every chat POST. Also exposes `window.Opps.setContext(token)` for manual refresh.
- **Xphere verification** (chat route): constant-time HMAC compare using the org's decrypted `medusa` integration key → check `v === 2` (reject v1 and any other version) → check `exp` → check `org` equals the org resolved from the widget token. On success: **(1)** consume `jti` via the `medusa_consume_context_jti` RPC (insert-once ledger keyed `(org_id, jti)`; a repeated `jti` is rejected as replay and the context is dropped, chat continues); **(2)** on successful jti consumption, merge claims into `conversations.memory.commerce` via `medusa_write_commerce_context`, which now also enforces `cnonce` binding — the conversation's **first** pin records `cnonce`; every later re-pin must present the same `cnonce` or the merge is aborted (`{rejected:true}`) and the prior pin is left intact. On any failure: log, drop the context, continue the chat (fail-soft — commerce tools then report "no cart connected").

### Identity pinning rules (anti-IDOR core)

- Commerce tool executors take `cart_id` / `customer_id` / `email` / `wishlist_ref` **exclusively** from the pinned `conversations.memory.commerce`. **Tool input schemas contain none of these fields.** The LLM addresses "the cart", never "a cart".
- Re-pinning is allowed only from a newly verified token (legit cart rotation after checkout) **and only when its `cnonce` matches the conversation's already-pinned `cnonce`**. Never from message text or model output.
- When the agent creates a cart (visitor had none), Xphere immediately writes `metadata.xphere_sig = hex(HMAC_SHA256(secret, cart_id))` onto the cart (store API cart update), pins it, and emits the `commerce`/`cart_created` SSE event including that `sig`.

## 4. Xphere → Medusa

### 4.1 Public store API (existing Medusa endpoints)

Headers: `x-publishable-api-key: <pk>` (from integration config). Base URL from `integrations.location_id`. Timeout 8s. Per-org budget 120 req/min.

| Xphere tool (`action_type`) | HTTP call |
|---|---|
| `medusa_search_products` | `GET /store/products?q=<term>&region_id=<r>&limit=5&fields=id,title,handle,thumbnail,description,*variants.calculated_price,*variants.options` |
| `medusa_get_product` | `GET /store/products/:id?region_id=` (accepts internal lookup by handle via `?handle=` list filter) |
| `medusa_get_cart` | `GET /store/carts/:cart_id` (pinned id) |
| `medusa_add_to_cart` | (no pinned cart) `POST /store/carts {region_id}` → sign metadata → then `POST /store/carts/:id/line-items {variant_id, quantity}` |
| `medusa_update_cart_item` | `POST /store/carts/:id/line-items/:line_id {quantity}`; `quantity: 0` → `DELETE /store/carts/:id/line-items/:line_id` |

Write clamps (enforced in the executor, not the prompt): quantity 1–10 per operation; ≤50 line items per cart; max 3 side-effecting commerce calls per turn, 25 per conversation, 60 per conversation per day.

### 4.2 Privileged agent surface (new Medusa routes)

All under `/agent/*`, guarded by a global middleware (`apps/backend/src/api/middlewares.ts`, matcher `/agent/*`):

- Headers: `X-Xphere-Timestamp: <unix seconds>` and `X-Xphere-Signature: v1=<hex hmac_sha256(XPHERE_CONNECTION_TOKEN, timestamp + "." + rawBody)>`
- Reject: missing headers, clock skew > 300s, signature mismatch (timing-safe compare). Respond `401 {"error":"unauthorized"}` with no detail about which check failed.

| Endpoint | Request body | Success response |
|---|---|---|
| `POST /agent/wishlists/list` | `{ "customer_id": "cus_..." }` OR `{ "guest_ref": "<uuid>" }` (exactly one) | `{ "wishlist": { "id", "items": [{ "id", "product_id", "variant_id", "product": { "title", "handle", "thumbnail" } }] } }` |
| `POST /agent/wishlists/add` | owner key (as above) + `{ "product_id", "variant_id"? }` | `{ "item": {...} }` — idempotent: duplicate add returns 200 with the existing item |
| `POST /agent/wishlists/remove` | owner key + `{ "product_id", "variant_id"? }` | `{ "removed": true }` (also 200 when it wasn't there) |
| `POST /agent/orders/status` | `{ "customer_id": "cus_...", "display_id"?: number }` — customer_id is the PINNED verified id; if display_id omitted return the most recent order | `{ "order": { "display_id", "status", "fulfillment_status", "payment_status", "total", "currency_code", "created_at", "items": [{ "title", "quantity" }] } }` or `404` |

Errors: `400` invalid body (zod), `401` auth, `404` not found. Wishlist caps: ≤100 items per wishlist (enforce in service; `409 {"error":"wishlist_full"}`).

## 5. Medusa → Xphere (observation webhooks)

`POST {XPHERE_BASE_URL}/api/v1/commerce/events`

- Headers: `Authorization: Bearer xph_...` (scope `commerce:events`), `Idempotency-Key: <event_id>`, `Content-Type: application/json`. Body ≤ 64KB.
- Body:

```jsonc
{
  "event_id": "evt_<uuid>",              // MUST equal Idempotency-Key header
  "type": "order.placed" | "customer.created",
  "occurred_at": "2026-07-17T12:00:00Z",
  "data": {
    // order.placed:
    "order_id": "order_...", "display_id": 12, "email": "a@b.com",
    "currency_code": "eur", "total": 123.45,         // MAJOR units (decimal), as Medusa v2 returns — NOT cents
    "cart_id": "cart_...",                            // links back to the originating conversation (may be null for non-cart orders)
    "items": [{ "title": "...", "variant_id": "...", "quantity": 1, "unit_price": 35.00 }],  // MAJOR units
    // customer.created:
    "customer_id": "cus_...", "first_name": "...", "last_name": "..."
  }
}
```

> **Money units (corrected v1.1):** Medusa v2 returns order `total` and `items.unit_price` in **major units** (e.g. `35` for €35.00 / `123.45` for €123.45), the same convention as the store product prices in §4.1 — *not* minor units/cents. The stuscle subscriber passes them through unconverted ("as Medusa returns them"); the xphere ingestion side (§ contract consumer, Phase 136) must treat them as major units and never divide by 100. `order.placed` / `customer.created` events emit only `{ id }` — the subscriber hydrates the full payload via `query.graph`, and resolves `cart_id` through the `order_cart` link entity filtered by `order_id`.

- Responses: `201 {"receipt_id"}` accepted · `200 {"duplicate":true}` replay · `401/403` auth/scope · `422` invalid.
- Xphere processing: dedupe insert into `commerce_event_receipts (UNIQUE(org_id, event_id))` → find-or-create contact by email → if `data.cart_id` matches a conversation's pinned cart, annotate `memory.commerce.last_order_display_id` → dispatch workflow events `commerce.order.placed` / `commerce.customer.created` (same pattern as `emitLeadCaptured`, audited in `event_dispatches`).
- Medusa sender (`apps/backend/src/lib/xphere-client.ts`): fire from subscribers, 3 attempts (backoff 2s/8s), give up with a log line — loss is tolerable, dedupe makes retries safe. No-op when `XPHERE_BASE_URL`/`XPHERE_CONNECTION_TOKEN` unset. Inbound rate: ≤600/min/org.

## 6. Chat SSE stream additions (xphere → widget)

The chat response stream is newline-delimited JSON. Existing events: `session`, `token`, `done`, `tool_call`, `error`. New:

```jsonc
{ "event": "commerce", "action": "cart_created" | "cart_updated",
  "cartId": "cart_01...", "itemCount": 3,
  "sig": "<hex hmac(secret, cartId)>" }        // sig present on cart_created only

{ "event": "ui", "component": "product_cards", "items": [
  { "id": "prod_...", "variantId": "variant_...", "title": "Sweatshirt",
    "thumbnail": "https://...", "price": "€35.00", "handle": "sweatshirt",
    "url": "/dk/products/sweatshirt" } ] }      // ≤ 5 items; url is storefront-relative
```

Widget behavior: `commerce` events are re-dispatched to the host page as `window.dispatchEvent(new CustomEvent('xphere:commerce', { detail: { action, cartId, itemCount, sig } }))`; `ui`/`product_cards` render as cards inside the chat (created with `createElement` + `textContent` — never innerHTML; the "Add to cart" button calls `Opps.sendMessage('Add "<title>" to my cart')` so every mutation flows through the agent).

Storefront bridge (client component listening for `xphere:commerce`):
- `cart_updated` → server action `refreshAgentCart()` (revalidate carts cache tag) → `router.refresh()`.
- `cart_created` → server action `adoptAgentCart(cartId, sig)`: verify `sig` (HMAC with `XPHERE_CONNECTION_TOKEN`), fetch the cart, require: exists, `completed_at` null, region matches current, `customer_id` null or equals current customer → `setCartId(cartId)` → revalidate + refresh. Invalid sig/state = silently ignore (log).

## 7. Rate limits & guardrails (xphere enforcement matrix)

`src/lib/rate-limit.ts` gains `failMode: 'open' | 'memory' | 'closed'` (`memory` = per-instance token-bucket fallback when Redis is down; `closed` = deny). Existing call sites keep `open`.

| # | Scope | Limit | Window | failMode | Enforced at |
|---|---|---|---|---|---|
| R1 | Chat msgs / IP | 20 | 60s | memory | chat route, before org lookup |
| R2 | Chat msgs / IP / day | 200 | 24h | memory | chat route |
| R3 | Chat msgs / session | 10 | 60s | memory | chat route |
| R4 | New sessions / IP | 10 | 1h | memory | chat route (session-create branch) |
| R5 | Chat msgs / org | 300 | 60s | open | chat route, after org resolve |
| R6 | Commerce reads / session | 30 | 60s | memory | tool executor |
| R7 | Commerce writes / session | 10 | 60s | closed | tool executor |
| R8 | Commerce writes / conversation / day | 60 | 24h | closed | tool executor |
| R9 | Order lookups / session / day | 5 | 24h | closed | tool executor |
| R11 | Medusa calls / org | 120 | 60s | memory | Medusa client wrapper |
| R12 | Inbound events / org | 600 | 60s | open | events route |
| R13 | Context mints / IP | 30 | 60s | (storefront-local) | `/api/chat-context` |

Plus: chat `message` max 4,000 chars; chat route `maxDuration` 10→60; commerce writes registered in `SIDE_EFFECTING_ACTIONS` (existing idempotency layer); order status only when a verified `cus` claim is pinned (guests are told to log in — OTP flow deferred).

## 8. Environment variables

**Stuscle backend `.env`**: `XPHERE_BASE_URL=http://localhost:3000`, `XPHERE_CONNECTION_TOKEN=xph_...`
**Stuscle storefront `.env.local`**: `NEXT_PUBLIC_XPHERE_WIDGET_URL=http://localhost:3000/widget.js`, `XPHERE_WIDGET_TOKEN=<org widget_token>`, `XPHERE_CONNECTION_TOKEN=xph_...`, `XPHERE_ORG_ID=<org uuid>`
**Xphere**: no new envs — everything per-org in the `integrations` row.

Widget mount (storefront `(main)` layout): `<script src={NEXT_PUBLIC_XPHERE_WIDGET_URL} data-token={XPHERE_WIDGET_TOKEN} data-context-endpoint="/api/chat-context" />`. Renders nothing when envs are missing.

## 9. Dev wiring checklist

1. Stuscle: `corepack pnpm infra:up && corepack pnpm db:migrate` (seed creates Europe/EUR region + 4 demo products + publishable key), `corepack pnpm dev` (:9000/:8000).
2. Xphere: run new migrations, `npm run build:widget`, `npm run dev` (:3000).
3. In Xphere dashboard: create API key with scope `commerce:events`; create Medusa integration (Server URL `http://localhost:9000`, publishable key from seed, connection token = the `xph_` key); allow `http://localhost:8000` in widget URL rules; attach the `medusa_*` tools to an agent set as the `web_widget` channel default.
4. Fill Stuscle envs (section 8), restart both.
