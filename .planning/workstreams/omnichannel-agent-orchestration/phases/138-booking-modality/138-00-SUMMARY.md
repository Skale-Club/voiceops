---
phase: 138-booking-modality
plan: 00
status: complete
completed: 2026-09-04
requirements: [MODAL-00]
---

# Plan 138-00 Summary

## Outcome

An organization now has a `business_type` an operator sets in `Settings → Company Info`,
and saving it seeds the booking modality's default (`organizations.service_location_mode`,
added one plan later in 138-01) without ever overwriting a mode an operator has already
chosen deliberately.

## Changes

- `supabase/migrations/1296_organization_business_type.sql` (authored only, not applied
  by this plan): `organizations.business_type TEXT NOT NULL DEFAULT 'on_premises_shop'`,
  `CHECK (business_type IN ('on_premises_shop', 'mobile_service', 'hybrid', 'other'))`. No
  backfill — the default matches every existing tenant's real behaviour today.
- `src/lib/org/business-type.ts`: `BUSINESS_TYPES`, `BUSINESS_TYPE_LABELS`,
  `isBusinessType()`, and the pure `deriveServiceLocationModeFromBusinessType()` mapping
  (`on_premises_shop → on_premises`, `mobile_service → at_customer`, `hybrid → either`,
  `other → on_premises`, anything unrecognised → `on_premises`). Duplicates the
  `ServiceLocationMode` literal union rather than importing it from 138-01's module (which
  did not exist yet when this plan ran), by design, per the module's own header comment.
- `src/app/(dashboard)/settings/company-info/actions.ts`: `companyProfileSchema` gains
  `business_type: z.enum(BUSINESS_TYPES).optional()`. `updateCompanyProfile()` detects "no
  explicit override" by comparing the org's current `service_location_mode` against what
  its current (pre-save) `business_type` would derive — if they still match, the stored
  mode is still tracking the auto-derived default and is safe to re-derive; if they
  differ, an operator diverged deliberately and the save leaves `service_location_mode`
  untouched.
- `src/components/settings/company-profile-form.tsx` (not listed in the plan's
  `files_modified`, added as a deviation — see below): a "Business type" select rendering
  `BUSINESS_TYPE_LABELS`, wired into the form's dirty-check and save payload the same way
  as `legal_name`/`timezone`.
- `src/app/(dashboard)/settings/company-info/page.tsx`: loads `business_type` from the org
  row and passes a coerced value (`isBusinessType(...) ? ... : 'on_premises_shop'`) as the
  form's initial state.
- `src/types/database.ts`: `organizations` `Row`/`Insert`/`Update` widened for
  `business_type` (and, ahead of 138-01's own migration, `service_location_mode`, so the
  build compiles once `CompanyProfileShape` requires both fields).
- `tests/org-business-type.test.ts`: 24 tests — migration-shape assertions, the pure
  vocabulary/derivation function (including every fail-closed case), and
  `updateCompanyProfile()`'s override-preserving save logic.

## Deviations from Plan

**1. [Rule 2 — missing critical functionality] `company-profile-form.tsx` not listed in
`files_modified`.** The plan's stated files (`actions.ts`, `page.tsx`) cannot alone satisfy
the plan's own success criterion ("an operator can set the business type in Company
Info") — the actual form control lives in the client component, not the page or the
action. Added the select there.

**2. [Rule 3 — build-compile dependency] `src/app/(dashboard)/settings/workspace/page.tsx`
and `service_location_mode` typing in `database.ts`.** Widening `CompanyProfileShape` with
a required `business_type` field broke an unrelated caller of the same shape in
`settings/workspace/page.tsx`; fixed inline. `service_location_mode` was added to
`database.ts` ahead of 138-01's migration because `updateCompanyProfile()`'s
override-detection logic (this plan) reads that column and the type had to exist for the
build to typecheck before 138-01 landed.

## Verification

- `npx vitest run tests/org-business-type.test.ts` — 24/24 passed (re-confirmed
  independently at verification time).

## Files Modified

- `supabase/migrations/1296_organization_business_type.sql`
- `src/types/database.ts`
- `src/lib/org/business-type.ts`
- `src/app/(dashboard)/settings/company-info/actions.ts`
- `src/app/(dashboard)/settings/company-info/page.tsx`
- `src/components/settings/company-profile-form.tsx` (deviation, not in original plan)
- `src/app/(dashboard)/settings/workspace/page.tsx` (deviation, not in original plan)
- `tests/org-business-type.test.ts`

## Commit

`0b835926` — `feat(138-00): give an organization a business type set in Company Info`

## Self-Check: PASSED (reconstructed independently from commit `0b835926` and the live
source tree; this SUMMARY was not written by the executing agent and is being added
retroactively during verification)
