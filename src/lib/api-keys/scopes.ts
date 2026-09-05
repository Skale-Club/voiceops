// Scopes a public API key (api_keys table) can hold. Shared by the settings UI,
// the key-generation server action, and the /api/v1/* route handlers so the
// allowed-scope list stays in one place.

export const API_KEY_SCOPES = [
  {
    key: 'leads:write',
    label: 'Leads - write',
    description: 'Ingest completed lead submissions via POST /api/v1/leads',
  },
  {
    key: 'contacts:write',
    label: 'Contacts — write',
    description: 'Create and update contacts via POST /api/v1/contacts',
  },
  {
    key: 'prospects:write',
    label: 'Prospects — write',
    description: 'Push prospect-stage records via POST /api/v1/prospects',
  },
  {
    key: 'prospects:enrich',
    label: 'Prospects — enrich',
    description: 'Trigger website analysis for accounts via POST /api/v1/accounts/:id/analyze',
  },
  {
    key: 'optout:write',
    label: 'Opt-out — write',
    description: 'Mark contacts/accounts as opted out via POST /api/v1/optout',
  },
  {
    key: 'commerce:events',
    label: 'Commerce — events',
    description: 'Ingest e-commerce events via POST /api/v1/commerce/events',
  },
  {
    key: 'xmail:events',
    label: 'Xmail — events',
    description: 'Ingest Xmail delivery and engagement events via POST /api/integrations/xmail/events',
  },
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]['key']

export const API_KEY_SCOPE_KEYS: ApiKeyScope[] = API_KEY_SCOPES.map((s) => s.key)

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPE_KEYS as string[]).includes(value)
}

/** True when the key's scope array grants the required scope. */
export function hasScope(scopes: string[] | null | undefined, required: ApiKeyScope): boolean {
  return Array.isArray(scopes) && scopes.includes(required)
}
