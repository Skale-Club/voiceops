-- =============================================================================
-- Migration 1297: Organization Service Location Mode
-- Phase 138 Plan 01 (MODAL-01, MODAL-02)
--
-- 138-CONTEXT.md "The setting": the booking engine serves two kinds of
-- business without a fork — one the customer visits (a barbershop) and one
-- that visits the customer (a cleaner, a mobile groomer, a technician).
-- This column is the per-organization switch that tells the engine which
-- one it is dealing with, so a prompt never has to hardcode "ask" or
-- "never ask" for an address again.
--
--   on_premises  customer comes to the business   (default — every tenant today)
--   at_customer  business goes to the customer    (address required to book)
--   either       depends on the service           (ask which, then collect if needed)
--
-- Seeded from organizations.business_type (migration 1296, Plan 138-00) at
-- the moment an operator sets a business type in Settings -> Company Info
-- (see src/lib/org/business-type.ts and updateCompanyProfile() in
-- src/app/(dashboard)/settings/company-info/actions.ts), but this column —
-- not business_type — remains the sole runtime authority: a barbershop that
-- starts doing home visits overrides this directly without reclassifying
-- itself.
--
-- Default 'on_premises' and no backfill: the default IS the safe value for
-- every current tenant, so merging this migration changes nobody's
-- behaviour. src/lib/agent-runtime/resolve-service-location-mode.ts
-- additionally fails closed to 'on_premises' on a missing row, a read
-- error, or any unrecognised stored value — never to a mode that asks for
-- an address on uncertain data.
--
-- This migration is authored only and must NOT be applied here (see
-- 138-CONTEXT.md and CLAUDE.md "db push is the only way to apply a
-- migration"). Migrations 1290-1296 are already applied or authored ahead
-- of this one; this migration joins them, unapplied.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS service_location_mode TEXT
    NOT NULL DEFAULT 'on_premises'
    CONSTRAINT chk_org_service_location_mode
      CHECK (service_location_mode IN ('on_premises', 'at_customer', 'either'));

COMMENT ON COLUMN public.organizations.service_location_mode IS
  'Phase 138 Plan 01 (MODAL-01/MODAL-02): booking modality. on_premises (default) =
   customer comes to the business, never ask for an address; at_customer = business
   goes to the customer, address required to book; either = depends on the service,
   ask one narrowing question then branch. Seeded from organizations.business_type
   (migration 1296) as a DEFAULT only — this column is the sole runtime authority
   and can be overridden independently of business_type. Absence of an explicit
   choice IS on_premises for every existing organization; no backfill performed.';
