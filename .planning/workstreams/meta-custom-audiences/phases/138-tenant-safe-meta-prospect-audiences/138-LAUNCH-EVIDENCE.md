---
phase: 138
date: 2026-08-11
status: preflight_blocked
tenant: Skale Club
---

# Phase 138 - Redacted Launch Evidence

This document intentionally stores only counts, safe states, timestamps, and
operator-approved labels. It must never contain email addresses, phone numbers,
persisted hashes, OAuth access tokens, service keys, or secret values.

## Checkpoint A - Database and Runtime

- Production schema audit: `meta_audience_config` exists in legacy form.
- Migration 1271 state: not applied.
- Membership ledger table: absent.
- Sync-run table: absent.
- Existing Skale Club audience configs: 0.
- Existing enabled configs: 0.
- GitHub runtime variable `NEXT_PUBLIC_SUPABASE_URL`: present.
- GitHub runtime secrets `SUPABASE_SERVICE_ROLE_KEY` and `ENCRYPTION_SECRET`: provisioned without displaying values.
- Production DDL/deploy: not started pending automated-gate disposition.

## Checkpoint B - Meta Connection

- Operator-selected account candidate: `Skale Club | U$`.
- Tenant connection row state: active.
- Token health: expired.
- Recorded expiry: 2026-08-02.
- Required action: reconnect Meta OAuth from the Skale Club tenant before any dry run or real write.

## Checkpoint C - Source Baseline

The planning-time 8/8/4 baseline covered Xcraper company rows only. The current
tenant also contains three eligible Xcraper contact rows whose identifiers do
not overlap the company rows.

| Safe measure | Current count |
|--------------|--------------:|
| Xcraper prospect companies | 8 |
| Xcraper prospect contacts | 3 |
| Total candidate entities | 11 |
| Unique candidate phones | 11 |
| Unique candidate emails | 7 |
| DND contacts | 0 |
| Unsubscribed/do-not-contact contacts | 0 |
| Archived duplicate contacts | 0 |

Operator must approve either the tenant-wide 11/11/7 master audience or a
company-only/saved-segment scope before terms acceptance and first upload.

## Checkpoint D - Controlled Sync

- Not started.
- No remote audience created by this phase.
- No Graph membership mutation performed.

## Checkpoint E - Recovery and Monitoring

- Not started.
