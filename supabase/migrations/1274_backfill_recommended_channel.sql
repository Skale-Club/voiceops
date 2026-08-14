-- =============================================================================
-- Migration 1274: backfill prospect `recommended_channel`.
--
-- `recommended_channel` (migration 1158) is the column the prospects list uses
-- to hand an operator a ready-to-work segment -- "these have a phone, call
-- them". It was left NULL on 15 of 22 prospects because the ingestion API only
-- ever copied a caller-supplied value, and the `google-maps` push path never
-- sent one. A column that is empty most of the time cannot be filtered on, so
-- the segment was unreachable even though the data was there.
--
-- The API now derives the value on write (lib/prospects/recommended-channel.ts).
-- This migration applies the same rule once to the rows that already exist:
-- email wins, else phone -> 'call', else leave NULL.
--
-- Accounts keep the scraped address in `custom_fields.email` (there is no email
-- column on accounts) -- the same place the Meta audience projection reads it
-- from. Contacts have a real `email` column.
--
-- Idempotent and non-destructive: `WHERE recommended_channel IS NULL` only ever
-- fills a gap, so re-running changes nothing and a value chosen by a human (or
-- sent explicitly by xcraper) is never overwritten.
-- =============================================================================

UPDATE public.accounts
SET recommended_channel = CASE
      WHEN COALESCE(TRIM(custom_fields ->> 'email'), '') <> '' THEN 'email'
      ELSE 'call'
    END,
    updated_at = now()
WHERE lifecycle_stage = 'prospect'
  AND recommended_channel IS NULL
  AND (
    COALESCE(TRIM(custom_fields ->> 'email'), '') <> ''
    OR COALESCE(TRIM(phone), '') <> ''
  );

UPDATE public.contacts
SET recommended_channel = CASE
      WHEN COALESCE(TRIM(email), '') <> '' THEN 'email'
      ELSE 'call'
    END,
    updated_at = now()
WHERE lifecycle_stage = 'prospect'
  AND recommended_channel IS NULL
  AND (
    COALESCE(TRIM(email), '') <> ''
    OR COALESCE(TRIM(phone), '') <> ''
  );

-- Serves the new channel filter on the prospects list, and the "has phone"
-- variant of it. Partial: prospect-stage rows are a tiny slice of both tables.
CREATE INDEX IF NOT EXISTS idx_accounts_prospect_recommended_channel
  ON public.accounts (recommended_channel)
  WHERE lifecycle_stage = 'prospect';

CREATE INDEX IF NOT EXISTS idx_contacts_prospect_recommended_channel
  ON public.contacts (recommended_channel)
  WHERE lifecycle_stage = 'prospect';
