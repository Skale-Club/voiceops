-- =============================================================================
-- Migration 1293: Per-Channel Routing Mode (Phase 134, Plan 02, ROLL-02)
--
-- 134-CONTEXT.md "Reversible routing does not exist at all": adds the switch
-- an operator can use to move ONE channel of ONE organization between the
-- legacy entry-agent path and Phase 132's `resolveTrustedAgentRoute()`
-- specialist path, and back, without destroying anything.
--
-- This is a DISTINCT concept from `routing_mode` on
-- src/app/(dashboard)/calls/settings-actions.ts / routing-actions.ts, which
-- is an unrelated call-handling setting (`browser` / `phone_forward` / `sip`)
-- stored on a different table. It is NOT overloaded or touched here.
--
-- Default is 'legacy' for every organization and channel, always. No row is
-- backfilled for any existing organization, so no organization is silently
-- migrated to specialist routing by this migration — the absence of a row
-- IS the legacy default, read by the resolver in
-- src/lib/agent-runtime/routing-mode.ts (fail-to-legacy on any uncertainty:
-- no row, missing configuration, unrecognised value, or malformed data).
--
-- Rollback-safety: this table only records WHICH PATH reads configuration.
-- It never stores agents, mappings, workflows, or invocation history, and
-- nothing here writes to those tables — flipping a row in this table cannot
-- destroy or mutate them.
--
-- This migration deliberately performs no data backfill and must NOT be
-- applied in Phase 134 (source-only; see 134-CONTEXT.md
-- "Human/Production Boundary"). Migrations 1290, 1291, and 1292 are already
-- unapplied; this one joins them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_channel_routing_modes (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID                  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel         public.agent_channel  NOT NULL,
  mode            TEXT                  NOT NULL DEFAULT 'legacy'
                                         CHECK (mode IN ('legacy', 'specialist')),
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agent_channel_routing_modes_org_channel UNIQUE (organization_id, channel)
);

ALTER TABLE public.agent_channel_routing_modes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_channel_routing_modes_org_channel
  ON public.agent_channel_routing_modes(organization_id, channel);

DROP POLICY IF EXISTS "agent_channel_routing_modes_all" ON public.agent_channel_routing_modes;
CREATE POLICY "agent_channel_routing_modes_all" ON public.agent_channel_routing_modes
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_agent_channel_routing_modes_updated_at ON public.agent_channel_routing_modes;
CREATE TRIGGER trg_agent_channel_routing_modes_updated_at
  BEFORE UPDATE ON public.agent_channel_routing_modes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.agent_channel_routing_modes IS
  'Phase 134 (ROLL-02): per (organization, channel) switch between the legacy entry-agent path and Phase 132 resolveTrustedAgentRoute() specialist routing. Absence of a row means legacy, the safe default for every organization and channel. Not the unrelated calls.routing_mode call-handling setting (browser/phone_forward/sip). Never written by the resolver itself — flipping this switch changes which path READS configuration, never the configuration (agents, agent_partners, workflows, agent_invocations) itself.';

COMMENT ON COLUMN public.agent_channel_routing_modes.mode IS
  'Phase 134 (ROLL-02): ''legacy'' (default) or ''specialist''. Any value outside this CHECK is rejected at the database boundary; the runtime resolver additionally fails closed to legacy on a missing row, a read error, or any unrecognised value.';
