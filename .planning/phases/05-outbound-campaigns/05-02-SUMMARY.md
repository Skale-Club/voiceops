---
phase: 05-outbound-campaigns
plan: 02
subsystem: csv-parser + test-harness
tags: [papaparse, csv, zod, testing, vitest]
dependency_graph:
  requires: [05-01]
  provides: [parseContactCSV, ContactRow, ParseResult, test_stubs]
  affects: [05-05]
tech_stack:
  added: [papaparse@5.5.3, @types/papaparse@5.5.2]
  patterns: [partial_success_parsing, phone_normalization_E164, it_todo_stubs]
key_files:
  created:
    - src/lib/campaigns/csv-parser.ts
    - tests/campaigns.test.ts
    - tests/csv-parser.test.ts
    - tests/campaign-webhook.test.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - 'use client' directive on csv-parser.ts: papaparse uses browser File API, must only be imported in client components
  - Partial success is correct: valid rows returned alongside errors array (not fail-all on first error)
  - Phone normalization: 10-digit US → +1 prefix, 11-digit starting with 1 → + prefix, else + prefix if missing
metrics:
  duration: ~6 minutes
  completed_date: "2026-04-03"
  tasks: 2
  files: 6
---

# Phase 05 Plan 02: papaparse + Test Stubs + CSV Parser Summary

papaparse installed, 3 test stub files created (38 it.todo), csv-parser.ts implemented with phone normalization and partial success.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Install papaparse, create 3 test stub files | 95f008a |
| 2 | Implement CSV parser utility | 95f008a |

## What Was Built

`src/lib/campaigns/csv-parser.ts`:
- `parseContactCSV(file: File): Promise<ParseResult>` — papaparse with `header: true, skipEmptyLines: true`
- `ContactRowSchema`: name min(1), phone via transform+refine (normalizePhone + E.164 regex)
- `normalizePhone`: 10-digit → +1 prefix, 11-digit starting with 1 → + prefix, else prepend +
- Columns beyond name+phone → `custom_data: Record<string, string>`
- Partial success: valid rows collected alongside errors, per-row error messages joined with `;`

Test stubs (38 it.todo total):
- `tests/campaigns.test.ts`: 14 stubs for createCampaign, startCampaign, pauseCampaign, stopCampaign, deduplication, outbound call payload
- `tests/csv-parser.test.ts`: 10 stubs for valid and invalid CSV input
- `tests/campaign-webhook.test.ts`: 12 stubs for mapEndedReasonToStatus and webhook route

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- src/lib/campaigns/csv-parser.ts: FOUND
- tests/campaigns.test.ts: FOUND
- tests/csv-parser.test.ts: FOUND
- tests/campaign-webhook.test.ts: FOUND
- npx vitest run tests/campaigns.test.ts tests/csv-parser.test.ts tests/campaign-webhook.test.ts: exit 0 (38 todo)
- commit 95f008a: FOUND
