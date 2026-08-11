-- =============================================================================
-- Migration 1269: Widget placement + spacing.
-- Until now the embedded chat widget was hardcoded to bottom-right with a fixed
-- 20px gap. These columns let each org anchor it to any of six screen positions
-- and tune the gap from the two edges it hugs:
--   - widget_position  — '<top|middle|bottom>-<left|right>'
--   - widget_offset_x  — px gap from the left/right edge
--   - widget_offset_y  — px gap from the top/bottom edge (ignored for middle-*)
-- Defaults reproduce the previous hardcoded placement exactly, so existing
-- installs render unchanged after this migration.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS widget_position text    NOT NULL DEFAULT 'bottom-right',
  ADD COLUMN IF NOT EXISTS widget_offset_x integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS widget_offset_y integer NOT NULL DEFAULT 20;

-- Keep the six anchors and the 0–200px spacing range enforced at the DB level so
-- a bad write can never push the widget off-screen for every visitor.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_widget_position_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_widget_position_check
  CHECK (widget_position IN (
    'top-left', 'top-right',
    'middle-left', 'middle-right',
    'bottom-left', 'bottom-right'
  ));

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_widget_offsets_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_widget_offsets_check
  CHECK (
    widget_offset_x BETWEEN 0 AND 200
    AND widget_offset_y BETWEEN 0 AND 200
  );
