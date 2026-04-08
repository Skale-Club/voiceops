-- Migration 017: Add tool_folder_order to organizations for persisted folder ordering
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS tool_folder_order TEXT[] NOT NULL DEFAULT '{}';
