-- A retried external import is the same run, not a new source. Consolidate
-- historical duplicates before enforcing that invariant in the database.

WITH ranked_sources AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY org_id, source_type, external_run_id
      ORDER BY created_at, id
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY org_id, source_type, external_run_id
      ORDER BY created_at, id
    ) AS position
  FROM public.prospect_sources
  WHERE external_run_id IS NOT NULL
), duplicate_map AS (
  SELECT id AS duplicate_id, canonical_id
  FROM ranked_sources
  WHERE position > 1
)
UPDATE public.prospect_engagement_events AS event
SET payload = jsonb_set(
  event.payload,
  '{source_run_id}',
  to_jsonb(duplicate_map.canonical_id::text),
  true
)
FROM duplicate_map
WHERE event.payload->>'source_run_id' = duplicate_map.duplicate_id::text;

WITH ranked_imports AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        org_id,
        entity_type,
        entity_id,
        event_type,
        coalesce(source_platform, ''),
        payload->>'source_run_id'
      ORDER BY created_at, id
    ) AS position
  FROM public.prospect_engagement_events
  WHERE event_type = 'imported'
    AND payload ? 'source_run_id'
)
DELETE FROM public.prospect_engagement_events AS event
USING ranked_imports
WHERE event.id = ranked_imports.id
  AND ranked_imports.position > 1;

WITH ranked_sources AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY org_id, source_type, external_run_id
      ORDER BY created_at, id
    ) AS position
  FROM public.prospect_sources
  WHERE external_run_id IS NOT NULL
)
DELETE FROM public.prospect_sources AS source
USING ranked_sources
WHERE source.id = ranked_sources.id
  AND ranked_sources.position > 1;

WITH imported_entities AS (
  SELECT
    payload->>'source_run_id' AS source_run_id,
    count(*)::integer AS imported_count
  FROM public.prospect_engagement_events
  WHERE event_type = 'imported'
    AND payload ? 'source_run_id'
  GROUP BY payload->>'source_run_id'
)
UPDATE public.prospect_sources AS source
SET imported_count = imported_entities.imported_count,
    updated_at = now()
FROM imported_entities
WHERE source.id::text = imported_entities.source_run_id;

DROP INDEX IF EXISTS public.idx_prospect_sources_run;
CREATE UNIQUE INDEX idx_prospect_sources_run
  ON public.prospect_sources (org_id, source_type, external_run_id)
  WHERE external_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_import_event_run_entity
  ON public.prospect_engagement_events (
    org_id,
    entity_type,
    entity_id,
    event_type,
    coalesce(source_platform, ''),
    (payload->>'source_run_id')
  )
  WHERE event_type = 'imported'
    AND payload ? 'source_run_id';
