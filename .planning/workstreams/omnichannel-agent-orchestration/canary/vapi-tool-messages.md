# Vapi tool messages — Cuts & Culture receptionist

Spoken by Vapi itself the instant a tool call fires. NOT prompt instructions:
the 2026-09-04 call went silent through two tool calls precisely because this
depended on the model remembering to speak first, and it did not.

Applied via `tests/manual/vapi-set-tool-messages.test.ts` (`npm run test:manual`).
Vapi has no inbound prompt/tool sync from this repo — see Phase 138 context.

## Measured tool latency that justifies each line

| Tool | Cold | Warm (<60s) |
|---|---|---|
| `business_info` | 1.9s | 0.15s |
| `list_services` | 0.7s | 0.19s |
| `lookup_customer` | 1.5–2.1s | — |
| `get_quote` | ~2.0s | no warm effect observed |
| `check_availability` | **7.5–8.0s** | 0.14s |
| `check_availability` + `staffId` | 4.5s | 0.15s |

Only availability is slow enough to need a second reassurance. Pre-warming a
week in parallel was tested and does NOT persist: all seven days re-measured at
~7.5s afterwards, so the short warm window is not a cache we can rely on. Our
own cache is the only durable fix.

## request-start (all eight)

| Tool | Line |
|---|---|
| `list_services` | Let me pull up what we offer. |
| `business_info` | One moment, let me check that. |
| `get_quote` | Let me get you the exact price. |
| `lookup_customer` | Let me look you up. |
| `check_availability` | Let me look at the book for you, one moment. |
| `book_appointment` | Alright, let me get that booked for you. |
| `reschedule_appointment` | Let me move that for you. |
| `cancel_appointment` | Let me take care of that cancellation. |

## request-response-delayed

| Tool | After | Line |
|---|---|---|
| `check_availability` | 4000ms | Still checking, bear with me. |
| `get_quote` | 3500ms | Just working that out. |

## request-failed — writes only

Each states plainly that nothing changed, so a failed write is never mistaken
for a completed one:

- `book_appointment` — "…Nothing was changed — would you like me to take a message?"
- `reschedule_appointment` — "…It's unchanged — shall I take a message?"
- `cancel_appointment` — "…It's still on the book — shall I take a message?"
