-- =============================================================================
-- Migration 1300: Ads connection health — separate selection from health
-- =============================================================================
-- `ads_connections.status` has been conflating two unrelated things:
--
--   | value       | what it actually means today | nature    |
--   |-------------|-------------------------------|-----------|
--   | active      | admin chose to show this account | selection |
--   | available   | connected, admin hasn't opted in | selection |
--   | error       | platform rejected the credential | health    |
--   | revoked     | in the CHECK, no current writer produces it | health |
--
-- When a connection flips to 'error', whatever selection value it had
-- (active/available) is overwritten and lost. And the OAuth callbacks
-- (src/app/api/ads/meta/callback/route.ts:87,
-- src/app/api/ads/google/callback/route.ts:82) deliberately preserve the
-- prior status so reconnecting doesn't re-show every account at once —
-- which means they also preserve 'error'. Reconnecting renews the token and
-- clears connection_error, but status stays 'error' forever.
--
-- Measured in production on 2026-09-09:
--   - 42 Meta rows and 20 Google rows, ALL status='error'. Zero 'active',
--     zero 'available'.
--   - The Meta tokens were renewed at 2026-09-09 14:12 UTC: token_expires_at
--     on those rows moved from 2026-08-02/08-14 to 2026-11-08 — genuinely
--     new, valid tokens — yet status stayed 'error' and the UI kept showing
--     the Reconnect banner (its text even changed from "The access token
--     expired" to the generic "The stored access token was rejected",
--     because connection_error/last_error_at had been cleared but status had
--     not — proof the callback ran and only status was stuck).
--
-- This migration:
--   1. Adds `health` (ok/error) as the single place credential health lives,
--      independent of `status`, which becomes selection-only
--      (active/available). `revoked` is intentionally NOT one of the allowed
--      health values: a repo-wide search found no writer that ever produces
--      it (api/ads/meta/disconnect/route.ts deletes the row instead of
--      marking it revoked) — see Phase 2 commit for the search. Keeping a
--      value nothing can produce would just be a trap for the next reader.
--   2. Backfills health from the current (conflated) status BEFORE narrowing
--      the status CHECK, so this migration never violates its own new
--      constraint. Idempotent: every branch's WHERE only matches rows still
--      carrying the old conflated status, so once a row backfills to
--      status='available' none of these UPDATEs touch it again.
--   3. Narrows the status CHECK to ('active','available').
--   4. Adds a generated `usable` column (status='active' AND health='ok') so
--      every reader that means "can I call the platform API with this row"
--      has exactly one place to ask, plus a partial index for it.
--
-- IMPORTANT — the backfill below is NOT a product decision, it is
-- information LOST TO THE BUG. Every row that was 'error' (or 'revoked')
-- comes back as status='available': whatever active/available choice the row
-- had before is unrecoverable, because that value was already destroyed the
-- moment the row first flipped to 'error' — that overwrite is the defect
-- this migration fixes, there is nothing left to restore from. The admin
-- re-picks which accounts are active in the existing "Select ad accounts"
-- dialog after this ships (see plan Fase 6).
--
-- Rows whose token had not actually expired backfill to health='ok'. This is
-- deliberately provisional — the token exists and hasn't expired, but
-- nothing has exercised it since the callback wrote it. That is true of all
-- 42 Meta rows after the 2026-09-09 14:12 UTC renewal (expires 2026-11-08).
-- Phase 4 wraps the Meta API callers in withConnectionHealth the same way
-- Google already is; the first real call self-corrects health if this
-- provisional 'ok' turns out to be wrong. The 20 Google rows' tokens expired
-- in June, so they backfill to health='error' and stay that way until
-- reconnected.
-- =============================================================================

BEGIN;

-- 1. New health column, independent of status. 'revoked' deliberately
-- excluded — see header.
ALTER TABLE public.ads_connections
  ADD COLUMN IF NOT EXISTS health TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE public.ads_connections
  DROP CONSTRAINT IF EXISTS ads_connections_health_check;

ALTER TABLE public.ads_connections
  ADD CONSTRAINT ads_connections_health_check
  CHECK (health IN ('ok', 'error'));

-- 2. Backfill BEFORE narrowing status.
--
-- error + token expired or never set -> health=error (nothing has proven the
-- credential works, and the last known state was a rejection).
UPDATE public.ads_connections
SET health = 'error', status = 'available'
WHERE status = 'error' AND (token_expires_at IS NULL OR token_expires_at <= now());

-- error + token still valid -> health=ok, provisional (see header). Phase 4's
-- withConnectionHealth corrects this on the first real API call.
UPDATE public.ads_connections
SET health = 'ok', status = 'available'
WHERE status = 'error' AND token_expires_at > now();

-- revoked (CHECK-legal today, but no writer produces it) -> unconditionally
-- health=error: a revoked credential is never healthy regardless of
-- token_expires_at, and 'revoked' is not a value the new health CHECK
-- allows. Matches zero rows as of 2026-09-09 (every row is 'error'), kept
-- for correctness against any row that might exist outside today's sample.
UPDATE public.ads_connections
SET health = 'error', status = 'available'
WHERE status = 'revoked';

-- 3. Narrow status to selection-only values. Safe now: the backfill above
-- guarantees no row is still 'error' or 'revoked'.
ALTER TABLE public.ads_connections
  DROP CONSTRAINT IF EXISTS ads_connections_status_check;

ALTER TABLE public.ads_connections
  ADD CONSTRAINT ads_connections_status_check
  CHECK (status IN ('active', 'available'));

-- 4. usable: the one place readers ask "can this row call the platform API".
ALTER TABLE public.ads_connections
  ADD COLUMN IF NOT EXISTS usable BOOLEAN
  GENERATED ALWAYS AS (status = 'active' AND health = 'ok') STORED;

CREATE INDEX IF NOT EXISTS idx_ads_connections_usable
  ON public.ads_connections (org_id, platform)
  WHERE usable;

COMMENT ON COLUMN public.ads_connections.health IS
  'Credential health, independent of status (selection). ok = token has not expired (provisional until exercised) or last real call succeeded; error = platform rejected the credential or the token is known expired. No writer produces ''revoked'' -- api/ads/meta/disconnect deletes the row instead of marking it, so it is not a legal value here (see migration 1300 header).';

COMMENT ON COLUMN public.ads_connections.status IS
  'Selection only, as of migration 1300: active = admin chose to show this account, available = connected but hidden. Credential health lives in the health column, not here -- do not overload this again.';

COMMENT ON COLUMN public.ads_connections.usable IS
  'Generated: status = ''active'' AND health = ''ok''. The single answer to "can a reader call the platform API with this connection" -- added by migration 1300 so callers stop reimplementing this by reading status alone.';

COMMIT;
