-- Migration 1267: move "look busy" from the event type to the calendar profile.
--
-- Look busy is now configured once per calendar, under Calendar → Preferences,
-- and applies to every event type that calendar hosts. Migration 1266 had put
-- it on event_types; that turned out to be the wrong home — an operator thinks
-- of "make my calendar look busy" as a property of the calendar, not something
-- to re-declare on each event type.
--
-- The event_types columns are dropped rather than left in place: 1266 landed a
-- day earlier, no deployed code ever read them, and every existing row held the
-- 'off' default with NULL parameters (verified before this migration), so there
-- is no data to preserve. Leaving them would repeat the dead-preference-column
-- problem SYNC-04 cleaned up.
--
-- Which slots get withheld is still keyed on the event type (see
-- src/lib/calendar/look-busy.ts): two event types on the same calendar withhold
-- different times, which is both more natural and unavoidable anyway since they
-- have different durations and therefore different slot grids.

ALTER TABLE public.calendar_profiles
  ADD COLUMN IF NOT EXISTS look_busy_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (look_busy_mode IN ('off', 'hide_percent', 'max_per_day')),
  ADD COLUMN IF NOT EXISTS look_busy_percent SMALLINT
    CHECK (look_busy_percent IS NULL OR look_busy_percent BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS look_busy_max_per_day SMALLINT
    CHECK (look_busy_max_per_day IS NULL OR look_busy_max_per_day BETWEEN 1 AND 50);

COMMENT ON COLUMN public.calendar_profiles.look_busy_mode IS
  'Artificial scarcity strategy for this calendar''s public booking pages: off | hide_percent | max_per_day. Enforced on both the slot display path and every booker-facing write path.';
COMMENT ON COLUMN public.calendar_profiles.look_busy_percent IS
  'hide_percent mode: share (1-90) of each day''s candidate slot grid to withhold. Deterministic per (event type, date, slot).';
COMMENT ON COLUMN public.calendar_profiles.look_busy_max_per_day IS
  'max_per_day mode: maximum slots offered per day (1-50), spread evenly across the day.';

ALTER TABLE public.event_types
  DROP COLUMN IF EXISTS look_busy_mode,
  DROP COLUMN IF EXISTS look_busy_percent,
  DROP COLUMN IF EXISTS look_busy_max_per_day;
