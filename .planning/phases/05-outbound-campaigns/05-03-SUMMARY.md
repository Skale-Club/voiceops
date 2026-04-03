---
phase: 05-outbound-campaigns
plan: 03
subsystem: campaign-engine
tags: [vapi, outbound, webhook, edge-function, realtime]
dependency_graph:
  requires: [05-01, 05-02]
  provides: [createOutboundCall, startCampaignBatch, mapEndedReasonToStatus, webhook_edge_function]
  affects: [05-04, 05-05]
tech_stack:
  added: []
  patterns: [EdgeRuntime.waitUntil, Promise.allSettled, optimistic_locking, fetch_only_edge_compat]
key_files:
  created:
    - src/lib/campaigns/outbound.ts
    - src/lib/campaigns/engine.ts
    - src/app/api/vapi/campaigns/route.ts
decisions:
  - Individual POST /call per contact (NOT Vapi Campaign API) — metadata.campaign_contact_id roundtripped for webhook correlation
  - Promise.allSettled for concurrent firing — partial failure does not stop batch
  - EdgeRuntime.waitUntil for async DB write in webhook route (same pattern as /api/vapi/tools)
  - Auto-complete campaign: check count of pending+calling after each webhook update; if 0, set status=completed with optimistic lock
  - mapEndedReasonToStatus is a pure exported function — fully testable without mocking
metrics:
  duration: ~10 minutes
  completed_date: "2026-04-03"
  tasks: 2
  files: 3
---

# Phase 05 Plan 03: Outbound Client + Engine + Webhook Edge Function Summary

Campaign execution layer: Vapi outbound call client, campaign engine with concurrency control, webhook Edge Function for end-of-call status updates.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Vapi outbound call client (outbound.ts) | e15b324 |
| 2 | Campaign engine + webhook route | e15b324 |

## What Was Built

`src/lib/campaigns/outbound.ts`:
- `createOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult>`
- Posts to `https://api.vapi.ai/call` with Bearer `VAPI_API_KEY`
- Payload: assistantId, phoneNumberId, customer, metadata (campaign_contact_id + campaign_id), assistantOverrides.variableValues
- Throws descriptive Error on non-2xx; throws if response.id missing

`src/lib/campaigns/engine.ts`:
- `mapEndedReasonToStatus(reason)`: completed for ended/exceeded, no_answer for no-answer/busy/voicemail, failed otherwise
- `startCampaignBatch(campaignId, supabase)`: fetches campaign (guards status=in_progress), fetches pending contacts up to min(calls_per_minute, 10), fires via Promise.allSettled, updates status to calling/failed per result
- `checkAndCompleteCampaign`: called when no pending contacts; sets campaigns.status=completed if no pending/calling remain

`src/app/api/vapi/campaigns/route.ts` (Edge Function):
- `export const runtime = 'edge'`
- Guards: non-end-of-call-report, non-outboundPhoneCall, missing campaign_contact_id → return 200
- Updates campaign_contacts via service-role; checks for campaign auto-completion
- Uses EdgeRuntime.waitUntil for async DB write

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- src/lib/campaigns/outbound.ts: FOUND
- src/lib/campaigns/engine.ts: FOUND
- src/app/api/vapi/campaigns/route.ts: FOUND
- EdgeRuntime.waitUntil present: FOUND
- mapEndedReasonToStatus exported: FOUND
- commit e15b324: FOUND
