# Wiring a Vapi voice receptionist to an Xkedule tenant

How to give a booking tenant a phone agent that quotes real prices, reads the real
calendar and writes real bookings. Worked example: **Cuts & Culture Barbershop**
(the Xkedule demo tenant, `demo.xkedule.com`).

## How the pieces fit

The voice path deliberately does **not** go through Xphere's agent runtime:

```
caller → Vapi (hosts the LLM + voice) → POST https://xphere.app/api/vapi/tools
       → resolveOrgForAssistant(assistantId)   ← assistant_mappings
       → resolveTool(orgId, toolName)          ← workflows kind='tool'
       → executeAction(xkedule_*)              ← integrations (provider='xkedule')
       → Xkedule /api/v1                       ← X-Xkedule-Key
```

Consequences worth knowing before you start:

- **The prompt and the model live in Vapi**, not in the `agents` table. The
  `agent_channel` enum has no voice member; agents are for text channels.
- **Tool names are the contract.** The name on the Vapi assistant must equal
  `workflows.tool_name` in the org. A typo produces "Tool not configured." spoken
  aloud, with no other symptom.
- **`assistant_mappings` decides which tenant gets booked.** It is keyed by
  `vapi_assistant_id`, globally unique.
- The same tool rows serve the web widget — build them once (see
  `docs/integrations/xkedule.md`).

## Prerequisites

1. An `integrations` row for the org: `provider='xkedule'`, `location_id` = the
   tenant base URL, `encrypted_api_key` = the connection token the Xkedule tenant
   stores in `integration_settings` (provider `xphere`).
2. The `workflows` (`kind='tool'`) rows for that org, each with
   `definition.trigger.config.input_schema` populated — **without it the model
   sees a tool with no parameters** and can only call it empty.
3. `VAPI_WEBHOOK_SECRET` set in the Xphere deployment. Vapi sends it back as the
   `X-Vapi-Secret` header; `verifyVapiSecret` rejects mismatches.

## Step 1 — Create the assistant in Vapi

`POST https://api.vapi.ai/assistant` with the account's private key, or build it
in the dashboard. Naming convention already in use: `Brand | Role | Language`.

```jsonc
{
  "name": "Cuts & Culture | Receptionist | EN",
  "firstMessage": "Cuts and Culture, this is the front desk — how can I help?",
  "model": {
    "provider": "openrouter",
    "model": "anthropic/claude-sonnet-4-6",
    "temperature": 0.4,
    "messages": [{ "role": "system", "content": "<the system prompt below>" }],
    "tools": [ /* the 8 tools below */ ]
  },
  "server": {
    "url": "https://xphere.app/api/vapi/tools",
    "secret": "<VAPI_WEBHOOK_SECRET>"
  }
}
```

### System prompt (voice)

Differs from the web-widget prompt in three ways that matter out loud: no
markdown, times spoken naturally, and phone numbers read back digit by digit.

```text
You are the front desk at Cuts & Culture Barbershop, 212 Newbury Street, Boston.
You are on a phone call. Speak in short, natural sentences — never read lists,
never use markdown, never spell out URLs.

NEVER invent a service, a price, an opening hour, or an available time. Every one
of those comes from a tool call.

- Relative days: call `datetime` is NOT available here. Ask the caller for the
  day ("this Thursday?") and confirm the date back to them before checking.
- `list_services` for what is offered; `get_quote` for a real total.
- `check_availability` before offering any time. Offer at most three, spoken
  naturally: "I have two fifteen, three o'clock, or four thirty."
- If the caller says they have been here before, or asks about "my appointment",
  use `lookup_customer` with their number. It returns the booking ids you need
  to change anything — never guess an id.
- `business_info` for hours, address, and the cancellation or no-show policy. If
  a policy comes back unpublished, say you will check with the shop. Do not
  invent one.
- Before `book_appointment`, read back the service, day, time, name and phone
  number — digits one at a time — and wait for a yes.
- Put anything the caller asks for into `notes` in their own words.

If a tool fails, say plainly that you cannot do it right now and offer to take a
message. NEVER say an appointment is booked unless the tool actually confirmed it.

Tone: warm, brief, unhurried. You are a barbershop, not a call centre.
```

### Tool definitions

Each entry is `{"type": "function", "function": {...}}` on the assistant. Names
must match `workflows.tool_name` exactly.

| Vapi tool name | Required parameters | Optional |
| --- | --- | --- |
| `list_services` | — | — |
| `business_info` | — | — |
| `get_quote` | `serviceIds` (string) | — |
| `check_availability` | `serviceIds` | `date`, or `startDate`+`endDate`; `staffId`, `includeStaff` |
| `lookup_customer` | `phone` | — |
| `book_appointment` | `serviceIds`, `bookingDate`, `startTime`, `customerName`, `customerPhone` | `customerEmail`, `staffMemberId`, `notes` |
| `reschedule_appointment` | `bookingId`, `bookingDate`, `startTime` | `staffMemberId` |
| `cancel_appointment` | `bookingId` | — |

Dates are `YYYY-MM-DD`, times `HH:MM` 24-hour, `serviceIds` a comma-separated
string. The canonical parameter descriptions live in
`workflows.definition.trigger.config.input_schema` for the org — copy them so the
spoken agent and the text agent describe the same tool the same way.

## Step 2 — Map the assistant to the org

```sql
insert into assistant_mappings (organization_id, vapi_assistant_id, name)
values ('<org uuid>', '<vapi assistant id>', 'Cuts & Culture | Receptionist | EN');
```

**Do not use "Sync from Vapi" to do this** when the assistant lives in a Vapi
account shared with another org. `syncVapiAssistants` upserts on
`vapi_assistant_id` and overwrites `organization_id`, so a sync run from the
account's "home" org silently steals the assistant back and the receptionist
starts booking into nothing. Insert the single row by hand instead.

## Step 3 — Prove it before buying a number

The Vapi dashboard's "Talk to assistant" places a web call — no phone number, no
telephony spend. That exercises the whole chain: voice → tool → Xkedule write.

Verify after a test call:

```sql
-- Xphere: the tool actually ran
select tool_name, status, execution_ms, error_detail
from workflow_runs where trigger_type = 'vapi' order by created_at desc limit 10;
```

```sql
-- Xkedule: the booking is real
select id, customer_name, booking_date, start_time, staff_member_id, notes
from bookings where tenant_id = <tenant> order by id desc limit 5;
```

A first test call is also the cheapest proof that the org's
`encrypted_api_key` decrypts under the deployment's `ENCRYPTION_SECRET` — if that
secret ever drifts from the one used when the credential was saved, every tool
returns its fallback message and nothing else in the system complains.

## Step 4 — Attach a phone number (optional, costs money)

Buy or import a number in Vapi and point it at the assistant. Then record it in
Xphere so inbound resolution has a fallback path when `assistant_mappings` misses:

```sql
insert into twilio_phone_numbers (organization_id, e164, friendly_name, vapi_assistant_id, is_active)
values ('<org uuid>', '+1XXXXXXXXXX', 'Cuts & Culture | Reception | (XXX) XXX-XXXX', '<assistant id>', true);
```
