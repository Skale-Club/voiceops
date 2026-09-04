---
phase: 138-booking-modality
status: ready_for_detailed_planning
created: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 138 Context — Booking Modality: On-Premises and At-Customer

## Goal

The booking engine serves two kinds of business without a fork: one the customer visits
(a barbershop) and one that visits the customer (a cleaner, a mobile groomer, a
technician). The conversation collects the customer's address at the right moment when,
and only when, the business needs it — and the engine, not the prompt author, decides
that.

## Why this is an engine concern

The operator's direction, verbatim in spirit: for businesses that go to the customer's
home, the address has to be collected at the proper point in the flow, and this must be
designed into the engine so it is ready for both kinds of appointment. A prompt that
hard-codes "do not ask for an address" works for Cuts & Culture and breaks the next tenant.
Today that hard-coding is exactly what the voice prompt does.

## What already exists — verified

| Layer | State |
|---|---|
| `src/lib/xkedule/actions/create-booking.ts` | Accepts `customerAddress` and forwards it as `address` to Xkedule. **The plumbing is done.** |
| Xphere `book_appointment` workflow (tool trigger `input_schema`) | No `customerAddress` field. |
| Vapi `book_appointment` function schema | No `customerAddress` parameter — the voice model **cannot** pass one even though the action accepts it. Params today: `serviceIds, bookingDate, startTime, customerName, customerPhone, customerEmail, staffMemberId, notes`. |
| Xkedule `business_info` | Exposes the business's own address, hours, phone, timezone. **Nothing about modality.** Xkedule will not tell us whether a service happens on site or at the customer. |
| `organizations` | Has the business's own `address_line1/2/city` for invoicing. No modality setting. |
| Voice prompt (Vapi) | Static text: "serves customers on site… do not ask for an address, ever." Correct for this tenant, wrong as a platform behaviour. |

So the gap is not in the booking action. It is that nothing upstream knows to ask.

## Design

### The setting

One per-organization value, because Xkedule does not carry it and the business owner is
the only one who knows:

```
organizations.service_location_mode
  'on_premises'   customer comes to the business   (default — matches every tenant today)
  'at_customer'   business goes to the customer    (address is required to book)
  'either'        depends on the service           (ask which, then collect if needed)
```

Default `on_premises` so no existing tenant changes behaviour. A later refinement can move
this per-service if Xkedule ever exposes it; the org-level flag is the minimum that makes
the engine honest.

### When the address is collected

After the service and price are settled and accepted, before the day and time. Rationale:
for a business that travels, where the customer is may constrain when they can be
served, so the address belongs before availability, not after. It sits beside the phone
number as the second identity fact the booking is keyed on.

`on_premises` → never asked. `at_customer` → required, read back, then booked.
`either` → one plain question ("Is this at the shop, or are we coming to you?") decides
which branch.

### Where the decision lives

Not in prompt text. The engine renders a modality block into whatever prompt the channel
uses, from the organization's setting:

- The Xphere mesh (widget): the Booking specialist's prompt gets the block at resolve time.
- Vapi (voice): the assistant's prompt is static text inside Vapi. Two options, pick one in
  planning: (a) sync the rendered prompt into the assistant from Xphere, or (b) use Vapi's
  assistant-request hook to override the prompt per call. (a) is simpler and keeps Vapi
  as a dumb transport; it needs a sync path that today does not exist.

  Verified: `src/lib/vapi/sync-assistants.ts` is inbound only — it mirrors the Vapi
  account's assistants into `assistant_mappings` so nobody registers ids by hand. Nothing
  in the codebase writes a prompt or a tool schema *into* a Vapi assistant; the prompt
  changes made during Phase 137 were applied by a manual PATCH from a probe script. So
  option (a) means building the first outbound sync, and that sync is also what would let
  the `customerAddress` parameter reach the Vapi function schema without hand-editing.

### Schema plumbing

- Add `customerAddress` to the Xphere `book_appointment` workflow `input_schema`.
- Add `customerAddress` to the Vapi function schema — required only when the org is
  `at_customer`, optional for `either`, absent for `on_premises`. This is the piece the
  voice model cannot work without.

## Locked decisions

- Modality is an organization setting on the Xphere side; Xkedule stays the source of
  truth for everything else.
- Default is `on_premises`. Merging changes nobody's behaviour.
- The address is collected after price acceptance and before availability.
- `book_appointment` stays the only writer; it already carries the address through.
- No prompt may hard-code "ask" or "never ask" for an address. The engine renders it.

## Verification focus

- An `on_premises` tenant is never asked for an address, and the Vapi schema for it does
  not expose the field.
- An `at_customer` tenant cannot reach `book_appointment` without an address, and the
  address arrives at Xkedule as `address`.
- `either` asks exactly one narrowing question and branches correctly.
- Cuts & Culture, set to `on_premises`, behaves identically to today.
- The rendered modality block is the same text on the widget and on voice for the same
  organization — one source, two channels.

## Out of scope

Travel-time availability (Xkedule does not model it), per-service modality, address
validation/geocoding.

---

## Addendum 2026-09-04 — the modality needs a business type above it

Reviewing the plans, the operator raised the case this phase exists for and one it had
missed. The case it serves: a cleaning company travels to the customer, so the address is
required; a barbershop does not, so asking for one is nonsense. The case it missed: that
distinction has to be **adaptable per business and set in the panel**, and the operator
asked whether such a setting already exists.

It does not. Verified against the schema: `organizations` has `legal_name`, `tax_id`,
address, `timezone`, `default_currency` and a `settings` JSON, and no industry or business
type. The `industry` column that exists belongs to `org_templates` — the sector a template
serves — and to `accounts`, which are companies inside a tenant's own CRM. Neither
describes the tenant. Nothing in `organizations.settings` holds a modality.

So `service_location_mode` on its own would have shipped as a column reachable only by
`UPDATE`, which is precisely the defect recorded in Phase 139's context about the mesh
being hand-assembled.

**Plan 138-00 is added ahead of the others.** It puts `business_type` on the organization,
exposes it in the existing `Settings → Company Info` form rather than inventing a surface,
and derives the modality's initial value from it. The derived value is a default only:
`service_location_mode` stays the authority, so a barbershop that starts doing home visits
can override it without changing what kind of business it says it is.

This also gives Phase 139 the question it should start from. Duplicating a tenant becomes
"what kind of business is this", with the modality, the prompts and eventually the choice
of mesh template following from the answer — rather than an operator picking a template by
name and hoping it matches.

