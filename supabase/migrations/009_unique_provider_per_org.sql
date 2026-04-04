-- Enforce one integration per provider per organization.
-- Deduplicate existing rows first (keep most recent per org+provider).
DELETE FROM integrations
WHERE id NOT IN (
  SELECT DISTINCT ON (organization_id, provider) id
  FROM integrations
  ORDER BY organization_id, provider, created_at DESC
);

ALTER TABLE integrations
  ADD CONSTRAINT integrations_org_provider_unique
  UNIQUE (organization_id, provider);
