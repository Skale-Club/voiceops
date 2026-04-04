-- Add key_hint column to integrations table
-- Stores masked API key (e.g. ••••••••last4) at write time,
-- eliminating the need to decrypt on every page load.
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS key_hint TEXT;
