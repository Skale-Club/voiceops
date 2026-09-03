-- =============================================================================
-- Migration 1290: Omnichannel Agent Invocation Foundation (Phase 131)
--
-- Adds voice to the shared agent channel domain and lets a Vapi assistant map
-- to an optional internal Xphere entry agent. The composite foreign key makes
-- cross-tenant bindings impossible at the database boundary.
--
-- This migration deliberately performs no data backfill. Existing mappings
-- keep entry_agent_id NULL and therefore retain the legacy direct-workflow path.
-- =============================================================================

ALTER TYPE public.agent_channel ADD VALUE IF NOT EXISTS 'voice';

-- A composite FK must reference a matching UNIQUE constraint. `agents.id` is
-- already globally unique; this additional key exists specifically so the FK
-- below can prove organization ownership in the same constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uniq_agents_organization_id_id'
      AND conrelid = 'public.agents'::regclass
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT uniq_agents_organization_id_id
      UNIQUE (organization_id, id);
  END IF;
END $$;

ALTER TABLE public.assistant_mappings
  ADD COLUMN IF NOT EXISTS entry_agent_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assistant_mappings_entry_agent_same_org_fkey'
      AND conrelid = 'public.assistant_mappings'::regclass
  ) THEN
    ALTER TABLE public.assistant_mappings
      ADD CONSTRAINT assistant_mappings_entry_agent_same_org_fkey
      FOREIGN KEY (organization_id, entry_agent_id)
      REFERENCES public.agents(organization_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assistant_mappings_entry_agent_id
  ON public.assistant_mappings(entry_agent_id)
  WHERE entry_agent_id IS NOT NULL;

COMMENT ON COLUMN public.assistant_mappings.entry_agent_id IS
  'Optional internal Xphere entry agent for this Vapi assistant. NULL preserves legacy direct-workflow routing.';
