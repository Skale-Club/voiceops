---
phase: 05-outbound-campaigns
plan: 04
subsystem: server-actions + api-routes
tags: [server-actions, api-routes, optimistic-locking, supabase, campaigns]
dependency_graph:
  requires: [05-03]
  provides: [createCampaign, getCampaigns, getCampaignDetail, importContacts, deleteCampaign, start_pause_stop_routes, phone_numbers_proxy]
  affects: [05-05]
tech_stack:
  added: []
  patterns: [server_action_pattern, optimistic_locking, service_role_for_bulk_insert, parallel_data_fetch]
key_files:
  created:
    - src/app/(dashboard)/outbound/actions.ts
    - src/app/api/campaigns/[id]/start/route.ts
    - src/app/api/campaigns/[id]/pause/route.ts
    - src/app/api/campaigns/[id]/stop/route.ts
    - src/app/api/vapi/phone-numbers/route.ts
decisions:
  - importContacts uses service-role client for bulk insert to bypass RLS; UNIQUE constraint at DB handles deduplication
  - 23505 error code treated as graceful duplicate (not thrown) in importContacts
  - getCampaigns fetches campaigns + contacts in parallel, aggregates counts in JS (no GROUP BY needed for MVP)
  - start/pause/stop routes use optimistic locking (status in WHERE clause) to prevent race conditions
  - deleteCampaign guards with .in('status', ['draft', 'completed', 'stopped']) — no deleting active campaigns
metrics:
  duration: ~8 minutes
  completed_date: "2026-04-03"
  tasks: 2
  files: 5
---

# Phase 05 Plan 04: Server Actions + Control API Routes + Phone Numbers Proxy Summary

Data layer connecting UI to campaign engine: 5 server actions for CRUD + 3 control API routes for start/pause/stop + Vapi phone numbers proxy.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Campaign server actions (actions.ts) | 5a4b263 |
| 2 | Campaign control routes + phone numbers proxy | 5a4b263 |

## What Was Built

`src/app/(dashboard)/outbound/actions.ts`:
- `createCampaign(input)`: inserts campaigns row, revalidates /dashboard/outbound
- `getCampaigns()`: parallel fetch campaigns + campaign_contacts, aggregates total/pending/completed/failed counts
- `getCampaignDetail(id)`: parallel fetch campaign + contacts
- `importContacts(input)`: service-role bulk insert, 23505 handled gracefully, returns {imported, duplicates}
- `deleteCampaign(id)`: guards on draft/completed/stopped status

`src/app/api/campaigns/[id]/start/route.ts`: 
- Auth check + status transition draft|scheduled|paused → in_progress + startCampaignBatch
- Returns {success, fired, errors}

`src/app/api/campaigns/[id]/pause/route.ts`:
- Auth check + status transition in_progress → paused (optimistic lock)

`src/app/api/campaigns/[id]/stop/route.ts`:
- Auth check + status transition in_progress|paused → stopped (optimistic lock)

`src/app/api/vapi/phone-numbers/route.ts` (Edge Function):
- Proxies GET https://api.vapi.ai/phone-number to avoid exposing VAPI_API_KEY to client

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- src/app/(dashboard)/outbound/actions.ts: FOUND
- src/app/api/campaigns/[id]/start/route.ts: FOUND
- src/app/api/campaigns/[id]/pause/route.ts: FOUND
- src/app/api/campaigns/[id]/stop/route.ts: FOUND
- src/app/api/vapi/phone-numbers/route.ts: FOUND
- commit 5a4b263: FOUND
