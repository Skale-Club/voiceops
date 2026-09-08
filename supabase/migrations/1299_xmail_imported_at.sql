-- 1299: Import-vs-enrol idempotency marker (Fase 37, Xphere half).
--
-- Evidence: three production runs on 2026-09-08 verified 80 sendable addresses
-- (69 ok, 9 catch_all, 2 unknown) and none reached Xmail, because the only
-- path that ever pushed a lead into Xmail was `prospects_enroll_in_campaign`
-- with confirmed:true — which imports AND enrols AND can activate sending in
-- one call. A human who only wants leads staged has to authorise sending to
-- get anything imported at all.
--
-- `prospects_import_to_xmail` (see src/lib/mcp/tools/prospects.ts) separates
-- "push into Xmail as a lead" from "enrol in a campaign". It needs a durable,
-- per-row marker to (a) skip prospects already staged on a repeat call and
-- (b) let `prospects_enroll_in_campaign` tell staged leads apart from ones
-- that still need `prospects_import_to_xmail` run first.
--
-- Deliberately NOT reusing `engagement_status`/`last_contacted_at`: those mean
-- "this prospect was contacted" (set by markEnrolled after a real send-path
-- enrolment) and importing sends nothing. Conflating the two would make an
-- import look like outreach happened.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS xmail_imported_at timestamptz;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS xmail_imported_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_org_xmail_imported_at
  ON public.contacts (org_id, xmail_imported_at);

CREATE INDEX IF NOT EXISTS idx_accounts_org_xmail_imported_at
  ON public.accounts (org_id, xmail_imported_at);
