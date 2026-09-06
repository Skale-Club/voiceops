# Xphere Public REST API

Base URL: `https://xphere.app/api/v1`

All endpoints support **CORS** — you can call them directly from browser JavaScript on any domain.

---

## Authentication

Every request must include a Bearer token in the `Authorization` header:

```
Authorization: Bearer xph_<token>
```

Tokens are generated in **Settings → API Keys** inside the Xphere dashboard. Each token is scoped to one organization. The full token is shown only once at creation time — copy and store it securely.

**Scopes:** each key holds one or more scopes that gate which endpoints it can call:

| Scope | Grants |
|-------|--------|
| `leads:write` | `POST /api/v1/leads` |
| `contacts:write` | `POST /api/v1/contacts` |
| `prospects:write` | `POST /api/v1/prospects` |

A request to an endpoint the key is not scoped for returns `403`.

**Token format:** `xph_` prefix followed by 64 hex characters (32 random bytes).

**Security:** Only the SHA-256 hash is stored in the database. A lost token cannot be recovered — revoke it and generate a new one.

---

## Endpoints

### POST /api/v1/contacts

Creates or updates a contact in your CRM. Deduplicates automatically:
1. If a live contact with the same phone (E.164) exists → updates it
2. Else if a live contact with the same email exists → updates it
3. Otherwise → creates a new contact

**Request**

```http
POST https://xphere.app/api/v1/contacts
Authorization: Bearer xph_...
Content-Type: application/json
```

**Body**

```json
{
  "name": "João Silva",
  "phone": "+5511987654321",
  "email": "joao@empresa.com",
  "company": "Cleaning Co",
  "source_label": "skaleclub",
  "tags": ["lead-quente"],
  "custom_fields": {
    "score": 72,
    "classificacao": "QUENTE",
    "tipo_negocio": "Cleaning Services",
    "utm_campaign": "black-friday"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Full name (1–200 chars) |
| `phone` | string | — | Phone number — any format, normalized to E.164 |
| `email` | string | — | Email address — normalized to lowercase |
| `company` | string | — | Company name |
| `source_label` | string | — | Label identifying the originating system (e.g. `"skaleclub"`, `"typeform"`). Stored in `custom_fields._api_source`. |
| `tags` | string[] | — | Tags to assign to the contact |
| `custom_fields` | object | — | Free-form key/value pairs stored in `contacts.custom_fields`. Merged into existing fields on update (not replaced). |

At least one of `phone`, `email`, or `name` must be provided.

**Response — 201 Created**

```json
{ "id": "uuid", "action": "created" }
```

**Response — 200 OK** (existing contact updated)

```json
{ "id": "uuid", "action": "updated" }
```

**Error responses**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{ "error": "Missing Bearer token" }` | No `Authorization` header |
| 401 | `{ "error": "Invalid or revoked API key" }` | Token not found or revoked |
| 422 | `{ "error": "Invalid request body", "details": [...] }` | Zod validation failed |
| 422 | `{ "error": "Provide at least one of: phone, email, name" }` | Empty payload |
| 500 | `{ "error": "Failed to create contact" }` | Database error |

---

### POST /api/v1/prospects

Ingests **prospect-stage** records (people or companies) into your CRM. Prospects
are created with `lifecycle_stage = 'prospect'` and stay out of the normal
Contacts / Companies views until an admin deliberately converts them.

Requires the `prospects:write` scope. Accepts either a **single** prospect or a
**batch**. A batch opens a source/run row (visible under Prospects → Sources) and
records an `imported` engagement event per record.

**Dedup** is by `source_id` (idempotent re-import) → email/phone (person) or
domain/name (company). If a match already exists **outside** the prospect stage
(already promoted into the CRM), it is left untouched and reported as `skipped` —
ingestion never pulls a real contact back to the prospect stage.

**Body — single**

```json
{
  "kind": "person",
  "name": "João Silva",
  "email": "joao@empresa.com",
  "phone": "+5511987654321",
  "company": "Acme Cleaning",
  "tags": ["cold"],
  "intent_level": "low",
  "qualification_status": "needs_review",
  "recommended_channel": "email",
  "score": 20,
  "source_id": "place_abc",
  "source_payload": { "raw": "..." }
}
```

**Body — batch**

```json
{
  "source": {
    "type": "xcraper",
    "key": "xcraper",
    "label": "Google Maps — construction New Bedford",
    "external_run_id": "run_123",
    "default_country": "US",
    "metadata": { "query": "construction", "location": "New Bedford, MA" }
  },
  "prospects": [
    { "kind": "company", "name": "Acme Cleaning", "domain": "acme.com", "phone": "5087001010", "source_id": "place_abc" },
    { "kind": "person", "name": "Maria Souza", "email": "maria@acme.com", "phone": "11987654321", "phone_country": "BR", "source_id": "ct_456" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"person"` \| `"company"` | — | Defaults to `person`. Person → contact, company → account. |
| `name` | string | — | Person/company name (company falls back to `company`). |
| `email`, `phone` | string | — | Person identifiers, normalized. |
| `phone_country` | string (ISO 3166-1 alpha-2) | — | Tells us how to read a bare national-format `phone` with no leading `+` (e.g. `"BR"`, `"PT"`, `"US"`). Falls back to `source.default_country`. Numbers already sent in E.164 (`+...`) don't need this. |
| `company`, `domain` | string | — | `domain` is the company dedup key. |
| `tags` | string[] | — | Tags to assign. |
| `intent_level` | `none`\|`low`\|`medium`\|`high` | — | Defaults to `none`. |
| `qualification_status` | `unqualified`\|`needs_review`\|`qualified` | — | Defaults to `needs_review`. |
| `recommended_channel` | `email`\|`sms`\|`whatsapp`\|`call`\|`visit`\|`linkedin` | — | Suggested next channel. |
| `score` | integer 0–100 | — | Lead score. |
| `source_id` | string | — | Stable external id for idempotent re-import. |
| `source_payload` | object | — | Raw record kept for enrichment/debugging. |
| `custom_fields` | object | — | Free-form key/value pairs. |
| `source` | object | — | Batch only — describes the run (`type`, `key`, `label`, `external_run_id`, `default_country`, `metadata`). |

At least one of `name`, `email`, `phone`, or `source_id` must be provided per record.

**Phone numbers and country context**

Store phone numbers in E.164 (`+15087001010`) whenever the source already knows
it — that's always unambiguous and needs no country hint. When a source only
has a bare national number (e.g. a Google Maps scrape returning `"5087001010"`
with no country code), pass a country so it's stored correctly instead of as
raw, unformatted digits:

- Per-record: set `phone_country` on that prospect.
- Per-run: set `source.default_country` once for a batch that's all scoped to
  one country (e.g. a scrape run targeting Brazil), and every record in it
  inherits that country unless it sets its own `phone_country`.

Without either, a bare non-`+` number is stored as-is (digits only) — it will
still display as raw digits in the CRM rather than a formatted number, since
there's no reliable way to infer a country from digits alone.

**Response — single (201 / 200)**

```json
{ "id": "uuid", "kind": "person", "action": "created" }
```

**Response — batch (201)**

```json
{
  "source_id": "run-uuid",
  "total": 2,
  "created": 2,
  "updated": 0,
  "skipped": 0,
  "results": [
    { "id": "uuid", "kind": "company", "action": "created" },
    { "id": "uuid", "kind": "person", "action": "created" }
  ]
}
```

**Error responses**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{ "error": "Missing Bearer token" }` | No `Authorization` header |
| 401 | `{ "error": "Invalid or revoked API key" }` | Token not found or revoked |
| 403 | `{ "error": "API key is missing the prospects:write scope" }` | Key not scoped for prospects |
| 422 | `{ "error": "Invalid request body", "details": [...] }` | Zod validation failed |

---

## Code Examples

### JavaScript / fetch

```js
const res = await fetch('https://xphere.app/api/v1/contacts', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer xph_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'João Silva',
    phone: '+5511987654321',
    email: 'joao@empresa.com',
    source_label: 'meu-site',
    tags: ['lead'],
    custom_fields: { origem: 'formulario-home' },
  }),
})
const { id, action } = await res.json()
console.log(action, id) // "created" or "updated"
```

### cURL

```bash
curl -X POST https://xphere.app/api/v1/contacts \
  -H "Authorization: Bearer xph_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "João Silva",
    "phone": "+5511987654321",
    "source_label": "skaleclub",
    "tags": ["lead-quente"],
    "custom_fields": { "score": 72, "classificacao": "QUENTE" }
  }'
```

### PHP

```php
$response = file_get_contents('https://xphere.app/api/v1/contacts', false, stream_context_create([
  'http' => [
    'method' => 'POST',
    'header' => implode("\r\n", [
      'Authorization: Bearer xph_...',
      'Content-Type: application/json',
    ]),
    'content' => json_encode([
      'name'         => 'João Silva',
      'phone'        => '+5511987654321',
      'source_label' => 'meu-site',
    ]),
  ],
]));
$data = json_decode($response, true);
```

### Python

```python
import requests

res = requests.post(
    'https://xphere.app/api/v1/contacts',
    headers={'Authorization': 'Bearer xph_...'},
    json={
        'name': 'João Silva',
        'phone': '+5511987654321',
        'source_label': 'typeform',
        'custom_fields': {'score': 72},
    },
)
print(res.json())  # {'id': '...', 'action': 'created'}
```

---

## Skale Club Websites Integration

Websites and Xphere are independently billed sibling products. Each Websites tenant
connects its own Xphere organization with a dedicated `leads:write` API key. Never use a
global environment key shared by tenants.

Validate a connection with `GET /api/v1/integration-info`. The response identifies the
organization bound to the key and reports whether `lead_ingestion` is available.

Send completed forms to `POST /api/v1/leads` with an `Idempotency-Key` header equal to the
payload's `event_id`. Xphere stores every unique submission as a lead receipt, independently
deduplicates the CRM contact by normalized phone then email, and emits `lead.captured` once.

```json
{
  "schema_version": "1.0",
  "event_id": "websites:mvp:4bf74e9f-0bc1-4e74-93d1-a99712dc2211",
  "occurred_at": "2026-06-20T15:04:05.000Z",
  "source": {
    "product": "skaleclub_websites",
    "tenant_ref": "mvp",
    "site_domain": "mvpbuildergroup.com",
    "form": "primary_lead_form"
  },
  "contact": {
    "name": "Jane Smith",
    "email": "jane@example.com",
    "phone": "+13055550199"
  },
  "lead": {
    "status": "new",
    "score": 18,
    "classification": "HOT",
    "page_url": "https://mvpbuildergroup.com/contact",
    "answers": { "project": "Kitchen Remodel" }
  }
}
```

Accepted events return `201`; identical replays return `200` with
`event_action: "duplicate"`; reusing an event ID with a different payload returns `409`.

### `source.product` values

`source.product` identifies which sibling product produced the lead. It is stored on the
receipt and is part of the deduplication key, so every product must send **its own** value:

| Value | Producer |
|-------|----------|
| `skaleclub_websites` | The Websites platform — one value shared by every Websites tenant; `tenant_ref` is the tenant slug |
| `skaleclub` | The Skale Club marketing site (`skale.club`) and its landing-page lead forms; `tenant_ref` is `skaleclub`, `form` is the form slug (e.g. `barbershop-leads`) |

Any other value is rejected with `422 invalid_payload`. Do not reuse another product's value —
it silently merges two products' leads in reporting.

### Legacy Global-Key Example (Do Not Use)

The following historical example is retained only to explain the superseded integration.
It is not tenant-safe and must not be deployed.

After a form is submitted in Skaleclub, call this endpoint in `runLeadPostProcessing()`:

```ts
// server/lib/xphere-sync.ts
export async function syncLeadToXphere(lead: FormLead) {
  const url = process.env.XPHERE_API_URL ?? 'https://xphere.app/api/v1/contacts'
  const token = process.env.XPHERE_API_KEY
  if (!token) return

  await fetch(url + '/contacts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: lead.nome,
      phone: lead.telefone,
      email: lead.email,
      company: lead.tipoNegocio,
      source_label: 'skaleclub',
      tags: lead.classificacao === 'QUENTE' ? ['lead-quente'] : ['lead'],
      custom_fields: {
        score: lead.scoreTotal,
        classificacao: lead.classificacao,
        tipo_negocio: lead.tipoNegocio,
        tempo_negocio: lead.tempoNegocio,
        orcamento: lead.orcamentoAnuncios,
        utm_source: lead.utmSource,
        utm_campaign: lead.utmCampaign,
        url_origem: lead.urlOrigem,
      },
    }),
  }).catch(err => console.error('[xphere-sync] error:', err))
  // fire-and-forget — does not block lead flow
}
```

Required env vars on Skaleclub:
```
XPHERE_API_KEY=xph_...   # generated in Xphere Settings → API Keys
XPHERE_API_URL=https://xphere.app/api/v1  # optional override
```

---

## Managing API Keys

Keys are managed in the Xphere dashboard at **Settings → API Keys**.

- Each key has a **name** (e.g. "Skaleclub Forms", "Typeform") and a **prefix** visible in the list for identification
- The full token is only shown once at creation — copy it immediately
- Revoke a key at any time; revoked keys return 401 immediately
- Multiple keys per org are supported — use separate keys per integration for auditability

---

## Data Model

When a contact arrives via the API:

- `contacts.source` is set to `'api'`
- `contacts.custom_fields._api_source` is set to the `source_label` value
- `contacts.phone_e164` and `contacts.email_normalized` are auto-generated (indexed)
- `contacts.tags` is set if provided (on create) or merged (on update when `tags` is non-empty)
- `custom_fields` from the request are **merged** into existing fields on update — existing keys not present in the request are preserved

---

## Extending the API

To add a new endpoint (e.g. `POST /api/v1/accounts`):

1. Create `src/app/api/v1/<resource>/route.ts`
2. Copy the Bearer auth pattern from [`src/app/api/v1/contacts/route.ts`](../../src/app/api/v1/contacts/route.ts)
3. Export an `OPTIONS` handler for CORS preflight
4. Return proper HTTP status codes (not always-200)
5. Add the endpoint to the table above in this document

The `api_keys` table schema is in `supabase/migrations/1147_public_api_keys.sql`.
