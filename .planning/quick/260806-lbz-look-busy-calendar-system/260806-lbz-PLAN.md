---
phase: 260806-lbz-look-busy-calendar-system
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/1266_event_types_look_busy.sql
  - src/types/database.ts
  - src/lib/calendar/look-busy.ts
  - src/lib/calendar/slots.ts
  - src/lib/calendar/booking-validation.ts
  - src/app/(dashboard)/calendar/_actions/bookings.ts
  - src/app/(dashboard)/calendar/_actions/event-types.ts
  - src/components/calendar/event-type-form.tsx
  - src/components/calendar/booking-slot-picker.tsx
  - tests/calendar-look-busy.test.ts
  - tests/calendar-slots.test.ts
  - tests/booking-validation.test.ts
  - docs/calendar/look-busy.md
---

# Look Busy — artificial scarcity for calendar slots

## Goal

Let an operator make a booking page show fewer open slots than the calendar
actually has free, so the agenda reads as in-demand. Configured per event type,
**off by default**, and enforced identically on the display path and every write
path.

## Current state (verified)

Slot generation is entirely real-availability driven. `generateSlots()`
(`src/lib/calendar/slots.ts:56`) walks the availability window on a
`durationMinutes + bufferMinutes` grid and drops a candidate only when it is
(a) inside `minAdvanceMinutes`, (b) overlapping a confirmed booking, or
(c) overlapping a Google Calendar busy interval. There is no concept of hiding a
free slot anywhere in the codebase.

Paths that must stay consistent:

| Path | Entry point | Today |
| --- | --- | --- |
| Public booking page display | `getAvailableSlots` (`_actions/bookings.ts:314`) → `generateSlots` | real availability |
| Operator troubleshooting view | `getDebugSlots` (`_actions/bookings.ts:409`) → `generateSlotsWithReasons` | tags `past` / `booked` / `google_busy` |
| Public booking write | `createBooking` (`_actions/bookings.ts:495`) → `resolveAndValidateSlot` | re-derives the grid independently |
| MCP / AI write | `bookings_create` (`src/lib/mcp/tools/bookings.ts:108`) → `resolveAndValidateSlot` | same |
| Operator drag-to-create | `createBookingInternal` (`_actions/bookings.ts:738`) | bypasses booker-facing availability by design |

`resolveAndValidateSlot` (`src/lib/calendar/booking-validation.ts:85`) is the
single shared gate for the two booker-facing write paths, and it deliberately
mirrors `generateSlots`'s grid and min-advance logic. **Any hiding rule must be
applied in both places or hidden slots stay bookable** by anyone who POSTs a
start time directly or asks the AI agent to book it.

Out of scope / untouched: the Xkedule provider path
(`src/lib/xkedule/actions/check-availability.ts`) returns slots from an external
system; the GHL `get_availability` action engine case
(`src/lib/action-engine/execute-action.ts:278`) routes to Cal.com. Neither reads
`event_types`, so neither is affected.

## Key design decisions

**1. Hide from the candidate grid, not from the free list.**
The hide-set is computed over every grid position the day has, *before* bookings
and Google busy times are subtracted. This is what makes the feature coherent:

- A slot's hidden/visible state does not flip when a neighbouring slot gets
  booked. (Filtering the post-conflict free list by percentage would re-reveal
  slots as the day fills, which looks broken and leaks the mechanism.)
- `resolveAndValidateSlot` can reproduce the exact same hide-set from
  `(event_type_id, date, availability windows, duration)` without re-querying
  bookings, so display and validation cannot diverge.

**2. Deterministic, never random.** The pick is a pure hash of
`` `${eventTypeId}|${localDate}|${slotStartIso}` `` (FNV-1a, in
`src/lib/calendar/look-busy.ts`). `Math.random()` would give a different agenda
on every refresh and every booker, and would make validation impossible to keep
in sync. Same input → same output, forever, on server and in tests.

**3. Two modes, both operator-legible.**

- `hide_percent` — hide N% of the day's grid. Answers "make it look ~60% full".
- `max_per_day` — show at most N slots, spread evenly across the day. The grid
  is cut into N buckets and one slot per bucket is chosen by hash, so the
  survivors never cluster into a single morning block the way a pure hash-rank
  cut would.

`off` is the default and short-circuits before any work.

**4. Never hide the whole day.** `hide_percent` is capped at 90 by a DB CHECK
and the engine always keeps `max(1, …)` grid positions. A day whose visible
slots are all taken by real bookings shows as empty — that already happens today
and is not new behaviour.

**5. Rejection is indistinguishable from real unavailability.** A hidden slot
requested directly returns the existing `outside_availability` error, not a new
code. A distinct error would tell a probing booker "this slot is free but
withheld", which defeats the feature.

**6. The troubleshooting view is publicly reachable, so the reveal needs auth.**
`debugMode` is turned on by `?debug=1` on the *public* booking page
(`src/app/book/[slug]/[eventType]/page.tsx:18` → `booking-page-client.tsx:122` →
`booking-slot-picker.tsx:78`), and `getDebugSlots` runs on a service-role client
with no auth check. Tagging hidden slots `look_busy` there unconditionally would
hand the whole mechanism to anyone who appends `?debug=1`. So `getDebugSlots`
reveals withheld slots **only** to an authenticated member of the event type's
org; for everyone else hidden slots are omitted entirely, making `?debug=1`
output identical to what a booker sees. (Pre-existing and left alone: `?debug=1`
already exposes `booked` / `google_busy` reasons publicly.)

## Prerequisite: multi-window day bug (must land first)

`getAvailableSlots` and `getDebugSlots` call `.maybeSingle()` on
`user_availability` and pass a single window into `generateSlots`
(`_actions/bookings.ts:344` and `:441`), so a weekday with 2+ configured windows
throws — a known pre-existing bug, documented as Pitfall 5 in
`.planning/workstreams/calendar-reliability/phases/126-booking-trust-boundary/126-RESEARCH.md`
and explicitly deferred in the header comment of `booking-validation.ts:28-34`.
`resolveAndValidateSlot` already handles all windows.

This is not optional cleanup here: the hide-set is a function of "the day's
grid". If display builds that grid from one window and validation builds it from
all windows, hash ranks differ and a slot shown to a booker gets rejected on
submit. Fixing it is Task 1.

## Tasks

### Task 1 — Multi-window day grid (prerequisite)

- `src/lib/calendar/slots.ts`: change `availability` on both `generateSlots` and
  `generateSlotsWithReasons` to `AvailabilityWindow[]`, iterate windows in
  chronological order, and concatenate. Keep `null`/`[]` → `[]`.
- `_actions/bookings.ts`: both slot actions select `user_availability` as an
  array (drop `.maybeSingle()`), pass all rows for the weekday.
- Update the existing `tests/calendar-slots.test.ts` call sites to the array
  shape, and add a two-window case (`08:00-12:00` + `14:00-18:00`) asserting no
  throw and no slot in the 12:00-14:00 gap.
- Remove the now-stale deferral note in `booking-validation.ts:28-34`.

### Task 2 — Migration + types

`supabase/migrations/1266_event_types_look_busy.sql`:

```sql
ALTER TABLE public.event_types
  ADD COLUMN IF NOT EXISTS look_busy_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (look_busy_mode IN ('off', 'hide_percent', 'max_per_day')),
  ADD COLUMN IF NOT EXISTS look_busy_percent SMALLINT
    CHECK (look_busy_percent IS NULL OR look_busy_percent BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS look_busy_max_per_day SMALLINT
    CHECK (look_busy_max_per_day IS NULL OR look_busy_max_per_day BETWEEN 1 AND 50);
```

No RLS change — `event_types` policies already scope by org. Add the three
fields to `event_types` Row/Insert/Update in `src/types/database.ts` (manual
edit, per CLAUDE.md), then `npx supabase db push`.

### Task 3 — Pure engine: `src/lib/calendar/look-busy.ts`

```ts
export type LookBusyMode = 'off' | 'hide_percent' | 'max_per_day'

export interface LookBusyConfig {
  mode: LookBusyMode
  percent: number | null
  maxPerDay: number | null
}

// Returns the subset of grid starts (ISO UTC) that must be withheld.
export function computeHiddenSlotStarts(params: {
  eventTypeId: string
  date: string            // 'YYYY-MM-DD' in host tz
  gridStarts: string[]    // every candidate start for the day, chronological
  config: LookBusyConfig
}): Set<string>

export function isSlotHidden(params: { …same, slotStartIso: string }): boolean
```

- `off`, empty grid, or a config whose parameter is null → empty set.
- `hide_percent`: `hideCount = min(grid.length - 1, round(grid.length * pct/100))`;
  rank grid by `hash(eventTypeId|date|start)`, hide the top `hideCount`.
- `max_per_day`: `keep = min(maxPerDay, grid.length)`; split the grid into `keep`
  contiguous buckets, keep the lowest-hash entry of each; hide the rest.
- No `Date.now()`, no `Math.random()`, no IO — pure so validation and display
  share it byte-for-byte.

`tests/calendar-look-busy.test.ts` covers: off is a no-op; determinism across
repeated calls; percent honours the floor of 1 visible; `max_per_day` returns
exactly `keep` visible and spreads across buckets; grid shorter than
`maxPerDay` hides nothing; hidden set is stable when the grid is unchanged.

### Task 4 — Display path

- `slots.ts`: add optional `lookBusy?: LookBusyConfig` + `eventTypeId?: string`
  to both generators. Build the full grid first, call
  `computeHiddenSlotStarts`, then apply. In `generateSlots` hidden slots are
  simply absent. `generateSlotsWithReasons` takes an extra
  `revealLookBusy: boolean`: when true a hidden slot surfaces as a new
  `SlotBlockReason` value `'look_busy'`; when false it is dropped from the
  result exactly as `generateSlots` would drop it.
- `_actions/bookings.ts`: both actions already `select('*')` on `event_types`,
  so pass `{ mode: et.look_busy_mode, percent: …, maxPerDay: … }` through.
  In `getDebugSlots`, compute `revealLookBusy` per decision 6 — `getUser()`,
  then confirm membership in `et.org_id` via the authenticated client (do **not**
  reuse the service-role client for that check). Anonymous or other-org callers
  get `false`.
- `booking-slot-picker.tsx`: add `look_busy: 'LOOK BUSY'` to `REASON_LABEL`
  (`:26-30`).
- Test in `tests/calendar-slots.test.ts`: with look-busy active,
  `generateSlotsWithReasons({ revealLookBusy: false })` returns exactly the same
  start times as `generateSlots` — the anonymous `?debug=1` leak guard.

### Task 5 — Write-path enforcement

In `resolveAndValidateSlot` (`booking-validation.ts`), after the existing
`withinAnyWindow` check passes:

1. Select the three `look_busy_*` columns in the `event_types` query at `:96`.
2. If mode is not `off`, rebuild the day's grid from *all* `user_availability`
   windows for that weekday (already fetched at `:127`) using the same
   `stepMs`, in the host timezone.
3. `isSlotHidden(...)` → return `{ ok: false, error: 'outside_availability' }`.

This is the step that closes the hole for MCP `bookings_create` and any direct
POST. `createBookingInternal` is intentionally left alone — an operator creating
a booking by hand should be able to use a withheld slot, which is consistent
with how it already bypasses booker-facing availability.

Add `tests/booking-validation.test.ts` cases: a hidden slot is rejected with
`outside_availability`; a visible slot with look-busy active is still accepted;
`off` behaves exactly as today.

### Task 6 — Operator UI

- `_actions/event-types.ts`: extend `eventTypeSchema` with
  `look_busy_mode: z.enum([...]).default('off')`,
  `look_busy_percent: z.number().int().min(1).max(90).nullable().optional()`,
  `look_busy_max_per_day: z.number().int().min(1).max(50).nullable().optional()`.
  `.superRefine` so the parameter matching the chosen mode is present, and null
  the unused one on write so stale values can't resurface. Add the fields to
  `EventTypeRow`.
- `event-type-form.tsx`: a mode `Select` plus a single conditional numeric
  input, following the existing `allowed_location_kinds` block (`:142`). Include
  a short caption stating plainly that this withholds genuinely free slots and
  reduces bookable capacity — the operator should not be able to enable it
  without seeing that.

### Task 7 — Docs + verification

- `docs/calendar/look-busy.md`: what each mode does, why the pick is
  deterministic, why hidden slots are also rejected on write, and the fact that
  `createBookingInternal` is exempt.
- `npm run lint`, `npx vitest run`, `npm run build`.

## Risks

- **Divergence between display and validation** is the one failure that matters:
  it shows a booker a slot and then refuses it. Mitigated by a single pure
  helper, by hiding from the pre-conflict grid, and by Task 1. The
  `tests/booking-validation.test.ts` cases in Task 5 are the regression guard.
- **`generateSlots` signature change** (Task 1) touches every call site and the
  existing slot tests. Small blast radius (2 callers, 1 test file), but it is a
  breaking change to a core function.
- **Mechanism disclosure via `?debug=1`**: the troubleshooting view is public.
  Handled by decision 6 and its regression test; if that auth gate is dropped,
  the feature is trivially detectable by any visitor.
- **Business cost**: the feature deliberately destroys real bookable capacity.
  Off by default, per event type, and surfaced in the UI caption.
- **Date-picker highlighting**: `getDaysWithAvailability` (`slots.ts:248`) marks
  a day bookable from weekday availability alone and does not consult slots, so
  a heavily-hidden day can still be clickable and then show few slots. Pre-
  existing behaviour (bookings already cause it); noted, not changed here.
