# Vapi tool messages — Cuts & Culture receptionist

Spoken by Vapi itself the instant a tool call fires. NOT prompt instructions:
the 2026-09-04 call went silent through two tool calls, and the 2026-09-05
call spoke a filler/promise ("Alright, let me get that booked for you" — on
the *prepare* call, before the server had decided anything) precisely because
this depended on the model remembering to speak first, or to speak the right
thing.

Applied via `tests/manual/vapi-set-tool-messages.test.ts` (dry run by default;
`APPLY=1 npx vitest run --config vitest.manual.config.ts
tests/manual/vapi-set-tool-messages.test.ts` to push). Vapi has no inbound
prompt/tool sync from this repo — see Phase 138 context.

## Rules (VOICE-CALL-4-PLAN.md item J, 2026-09-06 re-plan)

- `lookup_customer` has **no request-start message** — silent. Pickup already
  pays tool latency before the greeting; a spoken filler here is the first
  thing the caller hears.
- `book_appointment`, `reschedule_appointment`, `cancel_appointment` also have
  **no request-start message**. Each of these tools fires twice in a
  conversation — a *prepare* call that only assembles a confirmation, and a
  *confirmed* call that actually writes — and a request-start message fires on
  **both**, which is exactly how "Alright, let me get that booked for you"
  spoke a promise before the server had decided anything. The model itself is
  expected to say something ("Give me a moment while I book that") before the
  confirmed call — that is prompt work (owned elsewhere), not a tool message.
- No message may open with **Alright / Sure / Great / Perfect / Got it / No
  problem** — every one of those reads as agreement to, or a promise about,
  something the server hasn't done yet.
- `request-failed` messages are kept (a failed write must never be mistaken
  for a completed one) but rewritten without an "I'm sorry" or "Alright"
  opener.
- A tool that needs to go silent gets `messages: []` sent **explicitly** in
  the PATCH body, not the field omitted — see the script's comments for why
  (some APIs treat an omitted field as "leave this alone", not "clear it").

## Measured tool latency that justifies each line

| Tool | Cold | Warm (<60s, our own cache) |
|---|---|---|
| `business_info` | 1.9s | 0.15s |
| `list_services` | 0.7s | 0.19s |
| `lookup_customer` | 1.5–2.1s | — |
| `get_quote` | ~2.0s | no warm effect observed |
| `check_availability` | **7.5–8.0s** | 0.14s |
| `check_availability` + `staffId` | 4.5s | 0.15s |

Only availability is slow enough to need a second reassurance. Pre-warming a
week in parallel was tested and does NOT persist: all seven days re-measured
at ~7.5s afterwards, so the short warm window above is **our own TTL cache**
(`src/lib/xkedule/availability-cache.ts`), not something the provider itself
does — see the 2026-09-06 measurement below, which timed the raw provider
endpoint directly and found no material re-query speedup at all.

## Measured 2026-09-06 (`tests/manual/measure-availability-latency.test.ts`)

Raw `GET /api/v1/availability` against the live tenant (org
`31502b7d-f4bd-4493-91f7-fc6f2738a09d`, `serviceIds=333`), bypassing
`availability-cache.ts` entirely — this is Xkedule's own cost, not ours. Six
dates spread across the next three weeks; each queried cold, then immediately
again ("warm"), then again with `staffId=1`:

| Date | Cold (ms) | Warm, same query (ms) | `staffId=1` (ms) |
|---|---|---|---|
| 2026-09-08 | 9129 | 8399 | 5249 |
| 2026-09-11 | 7504 | 7615 | 4500 |
| 2026-09-15 | 7837 | 7828 | 4736 |
| 2026-09-19 | 7164 | 7167 | 4390 |
| 2026-09-23 | 7492 | 7453 | 4418 |
| 2026-09-27 | 5792 | 5780 | 3039 |
| **average** | **7486** | **7374** | **4389** |

Two findings past what the plan assumed:

- **Re-querying the identical date/service immediately does not speed it up**
  (7486ms → 7374ms, within noise). The ~150ms "warm" figure in the table above
  is entirely our own in-process TTL memo working as designed — Xkedule has no
  short-lived cache of its own that a bare re-query benefits from. That memo
  (60s TTL, fed by `prefetchXkeduleAvailability` after every quote) is
  therefore the *only* lever on this side of the integration; nothing about
  request timing or ordering will make a second cold-ish call faster.
- **`staffId=1` is consistently ~3s faster than the plain query** (4389ms vs
  7486ms average, every single date faster with staff pinned) — the opposite
  of what a naive "more filters = more work" guess would predict. Whatever
  Xkedule does server-side to answer "who's free" evidently touches less data
  than the union-across-all-staff computation the plain query runs. Worth
  raising on the Xkedule side together with the P0 cold-latency ask
  (VOICE-CALL-4-PLAN.md item E: "index on bookings by staff+date, precomputed
  day grid; target <1.5s cold") — today the *unfiltered* query is the one that
  most needs it.

## request-start

| Tool | Line |
|---|---|
| `list_services` | Let me pull up what we offer. |
| `business_info` | Let me check. |
| `get_quote` | Let me get the exact price. |
| `lookup_customer` | *(none — silent)* |
| `check_availability` | Let me look at the book. |
| `book_appointment` | *(none — silent; see rules above)* |
| `reschedule_appointment` | *(none — silent; see rules above)* |
| `cancel_appointment` | *(none — silent; see rules above)* |

## request-response-delayed

| Tool | After | Line |
|---|---|---|
| `get_quote` | 6000ms | Just working that out. |
| `check_availability` | 6000ms | Still looking, one moment. |
| `book_appointment` | 8000ms | Still working on that. |
| `reschedule_appointment` | 8000ms | Still working on that. |
| `cancel_appointment` | 8000ms | Still working on that. |

## request-failed — writes only

Each states plainly that nothing changed, so a failed write is never mistaken
for a completed one — rewritten 2026-09-06 to drop the "I'm sorry" opener:

- `book_appointment` — "I couldn't get that booked just now — nothing was changed. Would you like me to take a message?"
- `reschedule_appointment` — "I couldn't move that appointment — it's unchanged. Shall I take a message?"
- `cancel_appointment` — "I couldn't cancel that — it's still on the book. Shall I take a message?"

## Applied 2026-09-06

Pushed to the live assistant `99518fa7-09f1-4c76-b7c8-58cd8a92105c` (org
`31502b7d-f4bd-4493-91f7-fc6f2738a09d`) and verified by re-fetching the
assistant after the PATCH:

```
get_quote                request-start:"Let me get the exact price." | request-response-delayed:"Just working that out." @6000ms
list_services            request-start:"Let me pull up what we offer."
lookup_customer          NONE (silent)
book_appointment         request-response-delayed:"Still working on that." @8000ms | request-failed:"I couldn't get that booked just now — nothing was changed. Would you like me to take a message?"
reschedule_appointment   request-response-delayed:"Still working on that." @8000ms | request-failed:"I couldn't move that appointment — it's unchanged. Shall I take a message?"
cancel_appointment       request-response-delayed:"Still working on that." @8000ms | request-failed:"I couldn't cancel that — it's still on the book. Shall I take a message?"
business_info            request-start:"Let me check."
check_availability       request-start:"Let me look at the book." | request-response-delayed:"Still looking, one moment." @6000ms
```

**Known gap (not fixed here, out of this canary's file scope):** the next
time `pushAssistantConfig` (`src/lib/vapi/sync-assistant-config.ts`) runs a
full prompt/function push for this org, `existingToolMessagesOf()` there reads
tuned messages off the live assistant but only keeps a tool's messages when
`tool.messages.length > 0` (same gate in
`render-assistant-config.ts`'s `renderAssistantConfig()`). An intentionally
**empty** array — exactly what `lookup_customer`, `book_appointment`,
`reschedule_appointment` and `cancel_appointment` now carry for
request-start — reads back as "nothing tuned" and gets silently replaced with
the generic fallback (`'One moment.'`) on that next push, undoing the silence
this canary just applied. Fixing this needs both functions to distinguish
"tool absent from the live assistant" from "tool present with `messages: []`"
(e.g. `Record<string, VapiToolMessage[] | null>` with `null` only when the
tool truly had no `messages` key at all) — out of scope for this file; flagged
for whoever next touches `render-assistant-config.ts` / `sync-assistant-config.ts`.
