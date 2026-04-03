---
phase: 05-outbound-campaigns
plan: 01
subsystem: database
tags: [migration, rls, realtime, supabase, campaigns]
dependency_graph:
  requires: [01-foundation, 002_action_engine]
  provides: [campaigns_table, campaign_contacts_table, CampaignStatus, CampaignContactStatus]
  affects: [05-02, 05-03, 05-04, 05-05]
tech_stack:
  added: []
  patterns: [REPLICA_IDENTITY_FULL, partial_index, denormalized_org_id_for_rls]
key_files:
  created:
    - supabase/migrations/005_campaigns.sql
  modified:
    - src/types/database.ts
decisions:
  - REPLICA IDENTITY FULL on campaign_contacts is critical: without it Supabase Realtime payload.new only returns {id}
  - organization_id denormalized on campaign_contacts for RLS performance (not joined through campaigns)
  - UNIQUE(campaign_id, phone) at DB level — deduplication cannot be handled in app code alone
  - CampaignStatus and CampaignContactStatus declared before Database interface so they can be referenced inside it
metrics:
  duration: ~8 minutes
  completed_date: "2026-04-03"
  tasks: 2
  files: 2
---

# Phase 05 Plan 01: DB Migration + Types Summary

Database foundation for outbound campaigns: migration 005_campaigns.sql with campaigns and campaign_contacts tables, plus TypeScript types.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Write migration 005_campaigns.sql | 9694cd9 |
| 2 | Extend database.ts with campaign types | 9694cd9 |

## What Was Built

`supabase/migrations/005_campaigns.sql` creates two tables:

- `campaigns`: id, organization_id, name, vapi_assistant_id, vapi_phone_number_id, vapi_campaign_id, status (CHECK), scheduled_start_at, calls_per_minute (1-20), created_at, updated_at. RLS SELECT policy via get_current_org_id().
- `campaign_contacts`: id, campaign_id, organization_id, name, phone, custom_data (JSONB), status (CHECK), vapi_call_id, error_detail, called_at, completed_at, retry_count (max 2), created_at, updated_at. UNIQUE(campaign_id, phone). REPLICA IDENTITY FULL. RLS SELECT policy.

Indexes: org_id, status, composite org+status for campaigns; campaign_id, org_id, campaign+status, and partial vapi_call_id for campaign_contacts.

`src/types/database.ts` exports:
- `CampaignStatus` type alias
- `CampaignContactStatus` type alias
- `campaigns` and `campaign_contacts` table types inside `Database['public']['Tables']`

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- supabase/migrations/005_campaigns.sql: FOUND
- src/types/database.ts exports CampaignStatus: FOUND
- REPLICA IDENTITY FULL in migration: FOUND
- UNIQUE(campaign_id, phone) in migration: FOUND
- commit 9694cd9: FOUND
