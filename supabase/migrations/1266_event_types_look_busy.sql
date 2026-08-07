-- Migration 1266: "look busy" — per-event-type artificial scarcity.
--
-- Lets an operator withhold some genuinely free slots from the booking page so
-- the agenda reads as in-demand. Off by default, so no existing event type
-- changes behaviour.
--
-- Modes:
--   'off'          — no slots withheld (default)
--   'hide_percent' — withhold look_busy_percent% of the day's candidate grid
--   'max_per_day'  — show at most look_busy_max_per_day slots, spread evenly
--
-- The 90 ceiling on look_busy_percent is mirrored by MAX_HIDE_PERCENT in
-- src/lib/calendar/look-busy.ts, which additionally guarantees at least one
-- slot stays visible. No RLS change needed — event_types policies already
-- scope by org.

ALTER TABLE public.event_types
  ADD COLUMN IF NOT EXISTS look_busy_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (look_busy_mode IN ('off', 'hide_percent', 'max_per_day')),
  ADD COLUMN IF NOT EXISTS look_busy_percent SMALLINT
    CHECK (look_busy_percent IS NULL OR look_busy_percent BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS look_busy_max_per_day SMALLINT
    CHECK (look_busy_max_per_day IS NULL OR look_busy_max_per_day BETWEEN 1 AND 50);

COMMENT ON COLUMN public.event_types.look_busy_mode IS
  'Artificial scarcity strategy for the public booking page: off | hide_percent | max_per_day. Enforced on both the slot display path and every booker-facing write path.';
COMMENT ON COLUMN public.event_types.look_busy_percent IS
  'hide_percent mode: share (1-90) of the day''s candidate slot grid to withhold. Deterministic per (event type, date, slot).';
COMMENT ON COLUMN public.event_types.look_busy_max_per_day IS
  'max_per_day mode: maximum slots offered per day (1-50), spread evenly across the day.';
