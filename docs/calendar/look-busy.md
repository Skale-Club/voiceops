# Look Busy — artificial scarcity for calendar slots

Withholds some genuinely free slots from an event type's booking page so the
agenda reads as in-demand. Configured per event type under **Calendar → Event
Types**, and **off by default** — no existing event type changes behaviour.

This trades real bookable capacity for perceived scarcity. A withheld slot is
not bookable by *anyone* going through the booker-facing paths, including the AI
agent. Only the operator, creating a booking by hand, can use one.

## Modes

| Mode | Column | Behaviour |
| --- | --- | --- |
| `off` | — | Every open slot is offered. Default. |
| `hide_percent` | `look_busy_percent` (1–90) | Withholds that share of the day's slot grid. At least one slot per day always stays open, even at 90. |
| `max_per_day` | `look_busy_max_per_day` (1–50) | Offers at most N slots, spread evenly across the day's availability. |

`max_per_day` buckets the day into N contiguous chunks and keeps one slot from
each, rather than taking the N lowest-hash positions — otherwise every survivor
could land in the same morning block, which is both useless to the operator and
obviously synthetic.

Both bounds are enforced twice: a `CHECK` constraint in migration `1266` and
`zod` schemas in `_actions/event-types.ts` and `event-type-form.tsx`.

## Two invariants that hold the feature together

### 1. Slots are withheld from the candidate grid, not from the free list

The hide-set is computed over every slot position the day's availability windows
produce — *before* confirmed bookings and Google Calendar busy times are
subtracted.

This matters for two reasons:

- **Stability.** A slot's withheld state never flips as the day fills up. If the
  filter ran on the post-conflict free list instead, hiding "40% of what's free"
  would re-reveal withheld slots as real bookings arrived: a booker who saw
  three times in the morning would come back to a different three. That reads as
  a bug and advertises the mechanism.
- **Agreement between display and validation.** Because the grid depends only on
  `(event type, date, availability windows, duration)`, the write path can
  reproduce the exact same hide-set without querying bookings at all.

### 2. The pick is deterministic, never random

`computeHiddenSlotStarts` ranks slots by an FNV-1a hash of
`` `${eventTypeId}|${date}|${slotStartIso}` ``. Same inputs, same output,
forever, on the server and in tests.

`Math.random()` would give a different agenda on every page refresh and to every
booker simultaneously, and would make the display/validation agreement
impossible to maintain.

## Enforcement on every path

| Path | Entry point | Look-busy applied? |
| --- | --- | --- |
| Public booking page | `getAvailableSlots` → `generateSlots` | Yes — withheld slots are absent |
| Troubleshooting view (`?debug=1`) | `getDebugSlots` → `generateSlotsWithReasons` | Yes — see the auth note below |
| Public booking write | `createBooking` → `resolveAndValidateSlot` | Yes — rejected |
| AI agent / MCP write | `bookings_create` → `resolveAndValidateSlot` | Yes — rejected |
| Operator drag-to-create | `createBookingInternal` | **No — intentional** |

Without the write-path check the feature would be purely cosmetic: every hidden
slot would stay bookable by anyone POSTing a start time directly or asking the
agent to book it. `src/lib/calendar/look-busy.ts` is a single pure module used by
both sides precisely so they cannot drift; the test
`agrees with the display path: exactly the slots generateSlots offers are accepted`
in `tests/booking-validation.test.ts` is the regression guard.

`createBookingInternal` is exempt by design — it already bypasses booker-facing
availability windows and allows duration overrides, so an operator scheduling by
hand can use a withheld time.

### Rejection uses the existing error, on purpose

A withheld slot requested directly returns `outside_availability`, the same code
a genuinely unavailable time returns. A dedicated error code would tell a probing
booker "this time is free but withheld", which is exactly what must not leak.

### The troubleshooting view needs an auth gate

`?debug=1` on the public booking page turns on the slot-reason view, and it is
reachable by **any visitor** — `getDebugSlots` runs on a service-role client.
Tagging withheld slots `look_busy` there unconditionally would hand the
mechanism to the very bookers it is meant to be invisible to.

So `generateSlotsWithReasons` takes `revealLookBusy`, and `getDebugSlots` sets it
only for an authenticated member of the event type's org (`canRevealLookBusy`,
which deliberately uses the authenticated client, not the service-role one).
For everyone else withheld slots are dropped outright, making `?debug=1` output
identical to what a booker sees.

Note that `?debug=1` already exposes the `booked` and `google_busy` reasons
publicly. That is pre-existing behaviour, unchanged here.

## Related

- Engine: `src/lib/calendar/look-busy.ts` (pure — no IO, no `Date.now()`, no `Math.random()`)
- Grid + display: `src/lib/calendar/slots.ts`
- Write gate: `src/lib/calendar/booking-validation.ts`
- Migration: `supabase/migrations/1266_event_types_look_busy.sql`
- Tests: `tests/calendar-look-busy.test.ts`, `tests/calendar-slots.test.ts`, `tests/booking-validation.test.ts`

## Not covered

Provider-backed calendars are untouched: the Xkedule path
(`src/lib/calendar/../xkedule/actions/check-availability.ts`) and the GHL/Cal.com
`get_availability` action both return slots from an external system and never
read `event_types`.
