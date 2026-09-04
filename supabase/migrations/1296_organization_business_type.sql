-- =============================================================================
-- Migration 1296: Organization Business Type
-- Phase 138 Plan 00 (MODAL-00)
--
-- Addendum 2026-09-04 to 138-CONTEXT.md: service_location_mode (Plan 138-01,
-- migration 1297) needs an operator-settable business type above it, so a
-- tenant is configured by answering what kind of business it is, in the
-- panel (Settings -> Company Info), rather than by someone writing SQL
-- directly against organizations.service_location_mode.
--
-- business_type only supplies the DEFAULT for service_location_mode at the
-- moment an operator first sets it (see
-- src/lib/org/business-type.ts:deriveServiceLocationModeFromBusinessType and
-- the save logic in
-- src/app/(dashboard)/settings/company-info/actions.ts:updateCompanyProfile).
-- It is never read at runtime by the booking engine — service_location_mode
-- remains the sole authority there, and can be overridden independently of
-- business_type (e.g. a shop that starts doing home visits without
-- reclassifying itself).
--
-- Default 'on_premises_shop' matches every existing tenant's real-world
-- behaviour today (the customer comes to the business), so merging this
-- migration changes nothing until an operator explicitly changes it. No
-- backfill: the default IS the safe value for every current organization.
--
-- This migration is authored only and must NOT be applied here (see
-- 138-CONTEXT.md and CLAUDE.md "db push is the only way to apply a
-- migration"). Migrations 1290-1295 are already applied; this one and 1297
-- are not.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_type TEXT
    NOT NULL DEFAULT 'on_premises_shop'
    CONSTRAINT chk_org_business_type
      CHECK (business_type IN ('on_premises_shop', 'mobile_service', 'hybrid', 'other'));

COMMENT ON COLUMN public.organizations.business_type IS
  'Phase 138 Plan 00 (MODAL-00): what kind of business this organization is, set
   by an operator in Settings -> Company Info. Supplies the DEFAULT value of
   organizations.service_location_mode (migration 1297) when first set; never
   read directly by the booking engine at runtime, and never overwrites a
   service_location_mode an operator has already chosen deliberately.
   on_premises_shop = customer comes to the business (default, matches every
   tenant today); mobile_service = business goes to the customer;
   hybrid = depends on the service; other = does not fit these, and must not
   be forced into asking for an address by default. Absence of an explicit
   choice IS on_premises_shop for every existing organization.';
