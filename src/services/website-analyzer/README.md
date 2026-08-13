# Website Analyzer Setup

## One-time setup (run after deploy)

### 1. Apply database migration
```bash
psql "$DATABASE_URL" -f supabase/migrations/1204_website_analyses.sql
```

> **Note:** The migration file contains `ALTER TYPE public."ProspectEventType" ADD VALUE IF NOT EXISTS 'website_analyzed'`
> but `ProspectEventType` does not exist — `event_type` in `prospect_engagement_events` is plain `text`.
> The migration was applied to production with that line removed. The `'website_analyzed'` string value
> works fine as plain text without an enum.

### 2. Create Supabase Storage bucket
In Supabase Dashboard → Storage → New bucket → name: `website-screenshots` → Public: ON

Or via SQL (already done for production):
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('website-screenshots', 'website-screenshots', true, 5242880,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;
```

### 3. Install Playwright Chromium
```bash
npx playwright install chromium
# On Debian/Ubuntu (production):
npx playwright install-deps chromium
```

### 4. Environment variables needed
```
SKALECLUB_WEBSITES_URL=https://websites.skale.club
SKALECLUB_WEBSITES_API_KEY=<api key from skaleclub-websites>
CRON_SECRET=<random secret for cron auth>
XPHERE_BASE_URL=https://app.xphere.ai  # for Hermes skill
XPHERE_API_KEY=<prospects:enrich scoped api key> # for Hermes
```

## API Reference

### Trigger analysis
```
POST /api/v1/accounts/:id/analyze
Authorization: Bearer <prospects:enrich key>
```
Returns `202 Accepted` immediately. Analysis runs in the background.

### Check analysis status
```
GET /api/v1/accounts/:id/analyze
Authorization: Bearer <prospects:enrich key>
```
Returns the latest `website_analyses` row for the account (status, score, colors, screenshots, etc.).

### Cron (process pending)
```
GET /api/cron/website-analyzer
Authorization: Bearer <CRON_SECRET>
```
Reclaims stale analyses: rows in `pending`/`running` whose `updated_at` is older than a
10-minute threshold are marked `failed` via the `reclaim_stale_website_analyses` RPC
(added in migration 1273). This frees the account to be picked up again on a later tick —
a reclaimed row is never resurrected back to `pending`; a fresh analysis row is inserted
instead.

## Architecture

- **Playwright** runs headless Chromium on the Node.js server (not serverless).
- Screenshots are stored in Supabase Storage bucket: `website-screenshots` (public, 5 MB limit).
- **Fire-and-forget:** `POST` returns `202` immediately; `runAnalysis()` runs in background.
- On completion: updates `accounts.score` + `qualification_status`, inserts a `prospect_engagement_events` row with `event_type = 'website_analyzed'`.
- If score >= 60 → `qualified`; >= 30 → `needs_review`; < 30 → `unqualified`.

## Key files

| File | Purpose |
|------|---------|
| `extractor.ts` | Playwright browser automation — screenshots, colors, logo, headings, CTA detection |
| `index.ts` | Orchestrator — calls extractor, uploads screenshots, writes DB row, updates account |
| `types.ts` | `BrandColor`, `RawExtraction`, `AnalysisResult`, `AnalysisStatus` interfaces |

## Lead scoring logic

Score = opportunity score (higher = worse site = better prospect for a "we rebuilt your site" pitch):

| Signal | Points |
|--------|--------|
| Base (site reachable) | +25 |
| Not mobile-responsive | +20 |
| No CTA detected | +15 |
| No logo found | +10 |
| No CSS custom properties (old site) | +10 |
| Load time > 4 s | +10 |
| Has contact info (reachable) | +5 |
| Fewer than 2 brand colors | +5 |
| **Max** | **100** |
