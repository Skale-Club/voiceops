---
phase: 05-outbound-campaigns
plan: 05
subsystem: dashboard-ui
tags: [react, next-app, supabase-realtime, csv-import, shadcn, campaigns]
dependency_graph:
  requires: [05-04]
  provides: [campaigns_list_page, new_campaign_page, campaign_detail_page, realtime_status_board]
  affects: []
tech_stack:
  added: []
  patterns: [supabase_realtime_postgres_changes, server_component_initial_data, client_component_optimistic_ui]
key_files:
  created:
    - src/app/(dashboard)/outbound/page.tsx
    - src/app/(dashboard)/outbound/new/page.tsx
    - src/app/(dashboard)/outbound/[id]/page.tsx
    - src/components/campaigns/campaign-list.tsx
    - src/components/campaigns/campaign-form.tsx
    - src/components/campaigns/contact-status-board.tsx
    - src/components/campaigns/csv-import-form.tsx
  modified:
    - src/components/layout/app-sidebar.tsx
decisions:
  - Server components for list and detail pages (initial data via server actions)
  - ContactStatusBoard is client component with Supabase Realtime subscription for per-contact live updates
  - CsvImportForm parses client-side (papaparse) then submits to importContacts server action
  - Campaign detail page shows CsvImportForm only for draft/scheduled status (not active campaigns)
  - callControl uses optimistic UI: locally updates currentStatus on success without page refresh
  - Sidebar Campaigns item changed active: false → active: true to enable navigation
metrics:
  duration: ~12 minutes
  completed_date: "2026-04-03"
  tasks: 2
  files: 8
---

# Phase 05 Plan 05: Dashboard UI + Realtime Status Board + Sidebar Summary

Campaigns dashboard UI: list page, create form, campaign detail with real-time contact status board (Supabase Realtime), CSV import form, and sidebar activation.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Campaign list page + create form + sidebar | e613b46 |
| 2 | Campaign detail page + Realtime status board + CSV import | e613b46 |

## What Was Built

Pages:
- `/dashboard/outbound` — server component, fetches getCampaigns(), renders CampaignList
- `/dashboard/outbound/new` — server component, renders CampaignForm
- `/dashboard/outbound/[id]` — server component, fetches getCampaignDetail(), renders ContactStatusBoard + CsvImportForm

Components:
- `campaign-list.tsx`: shadcn Table, CampaignStatusBadge with color map, delete confirmation, empty state with Phone icon
- `campaign-form.tsx`: fetches assistants + phone numbers on mount, 5 form fields, redirects on success
- `contact-status-board.tsx`: Supabase Realtime subscription on `campaign_contacts` UPDATE events filtered by campaign_id; progress metrics grid; Start/Pause/Stop control buttons; contact table with StatusBadge; progress bar
- `csv-import-form.tsx`: file input → parseContactCSV → row count + errors preview → importContacts → result display

Sidebar: Campaigns nav item `active: false` changed to `active: true`.

## Note: autonomous: false

This plan has `autonomous: false`. All code has been implemented. The human UAT checkpoint involves:
1. Navigate to `/dashboard/outbound` in browser
2. Create a campaign with an assistant and phone number
3. Import a CSV file with name+phone columns
4. Start the campaign and observe contact status updates in real time
5. Test Pause and Stop controls

Realtime updates require REPLICA IDENTITY FULL to be applied to the database (via 005_campaigns.sql migration) and the Supabase Realtime feature enabled for the `campaign_contacts` table in the Supabase dashboard.

## Deviations from Plan

### Auto-added - Rule 2

**[Rule 2 - Missing Env Var] Add VAPI_API_KEY to .env.example**
- Found during: Review before completion
- Issue: VAPI_API_KEY was used in outbound.ts and phone-numbers proxy but not documented in .env.example
- Fix: Added VAPI_API_KEY entry with comment to .env.example
- Note: .env.example is gitignored in this project (local only)

## Known Stubs

None - all components receive real data from server actions and Supabase Realtime.

## Self-Check: PASSED

- src/app/(dashboard)/outbound/page.tsx: FOUND
- src/app/(dashboard)/outbound/new/page.tsx: FOUND
- src/app/(dashboard)/outbound/[id]/page.tsx: FOUND
- src/components/campaigns/contact-status-board.tsx with postgres_changes: FOUND
- src/components/campaigns/csv-import-form.tsx: FOUND
- Sidebar active: true for Campaigns: FOUND
- commit e613b46: FOUND
