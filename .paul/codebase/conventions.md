# Operator — Code Conventions & Patterns

**Last updated:** 2026-04-03

## Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| React components | PascalCase | `AssistantMappingForm`, `CallsTable` |
| Functions | camelCase verb | `startCampaignBatch`, `executeAction` |
| Types/Interfaces | PascalCase | `CampaignStatus`, `VapiPayload` |
| Constants | UPPER_SNAKE_CASE | `TIMEOUT_MS`, `MAX_FILE_SIZE_BYTES` |
| DB columns | snake_case | `organization_id`, `vapi_assistant_id` |
| Files | kebab-case | `assistant-mapping-form.tsx`, `csv-parser.ts` |

## File Organization

- **Page route**: `src/app/(dashboard)/[feature]/page.tsx` — async server component
- **Server actions**: `src/app/(dashboard)/[feature]/actions.ts` — `'use server'` module
- **Components**: `src/components/[feature]/[component-name].tsx`
- **Business logic**: `src/lib/[subsystem]/[verb-noun].ts`
- **Types**: `src/types/database.ts` (Supabase-generated), `src/types/vapi.ts` (Zod schemas)
- **Tests**: `tests/[feature].test.ts`

## TypeScript

- `strict: true` in `tsconfig.json`
- No `any` — use proper types or `unknown` with narrowing
- Supabase `Database` type from `src/types/database.ts` used throughout
- Zod schemas + `z.infer<typeof schema>` for form/API types
- Exhaustiveness checks in switch statements: `const _exhaustive: never = actionType`
- Generic Supabase client: `SupabaseClient<Database>`
- `type` keyword for import-only types: `import type { Database } from '@/types/database'`

## Import Style

- Always use path alias `@/*` → `src/*` (configured in `tsconfig.json`)
- No relative imports like `../../lib/foo`
- Destructure named imports: `import { createServerClient } from '@/lib/supabase/server'`

## React Component Pattern

```tsx
// Server component (default) — async, no 'use client'
export default async function CallsPage({ searchParams }: { searchParams: Promise<...> }) {
  const params = await searchParams  // Next.js 15 requirement
  const [calls, assistants] = await Promise.all([getCalls(params), getAssistants()])
  return <CallsTable calls={calls} assistants={assistants} />
}

// Client component — explicit opt-in
'use client'
interface Props {
  mode: 'create' | 'edit'
  onSuccess?: () => void
}
export function AssistantMappingForm({ mode, onSuccess }: Props) { ... }
```

## Form Pattern

```tsx
const schema = z.object({ name: z.string().min(1), ... })
type FormValues = z.infer<typeof schema>

const form = useForm<FormValues>({
  resolver: zodResolver(schema),
  defaultValues: { name: '' }
})

async function onSubmit(values: FormValues) {
  const result = await serverAction(values)
  if (result.error) {
    toast.error(result.error)
    return
  }
  toast.success('Saved')
  onSuccess?.()
}
```

## Server Action Pattern

```ts
'use server'
export async function createThing(data: InputType): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // Get org
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization' }

  const { error } = await supabase.from('things').insert({ ...data, organization_id: orgId })
  if (error) {
    if (error.code === '23505') return { error: 'Already exists' }
    return { error: error.message }
  }

  revalidatePath('/dashboard/things')
  return {}
}
```

## API Route Pattern

```ts
// Webhook routes: always 200, never throw to caller
export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = Schema.safeParse(body)
    if (!parsed.success) return Response.json({ ok: true })  // ignore invalid

    // ... process
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: true })  // never fail webhooks
  }
}

// Dashboard API routes: proper status codes
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // ...
  return Response.json({ data }, { status: 200 })
}
```

## Error Handling Patterns

| Context | Pattern |
|---------|---------|
| Server actions | Return `{ error?: string }` — never throw |
| Client components | `toast.error(result.error)` from sonner |
| Webhook routes | Always return 200; log errors internally |
| Dashboard API routes | Proper HTTP status codes (401, 403, 404, 409) |
| DB unique constraint | Check `error.code === '23505'` → user-friendly message |
| Async errors | `err instanceof Error ? err.message : 'Unknown error'` |

## Supabase Client Usage

```ts
// In server actions and dashboard pages
import { createServerClient } from '@/lib/supabase/server'
const supabase = await createServerClient()

// In /api/vapi/* webhooks (bypasses RLS)
import { createAdminClient } from '@/lib/supabase/admin'
const supabase = createAdminClient()
```

## Encryption Pattern

```ts
// Store: encrypt(plaintext) → "iv:ciphertext"
// Retrieve: decrypt("iv:ciphertext") → plaintext
// Display: maskApiKey("sk-abc123") → "••••••••3"
// src/lib/crypto.ts
```

## Timing & Timeout Pattern

```ts
// AbortController for GHL API calls (400ms hard limit)
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
try {
  const res = await fetch(url, { signal: controller.signal, ... })
} finally {
  clearTimeout(timeoutId)
}
```

## Database Query Style

```ts
// Fluent Supabase API — always scope by org_id
const { data, error } = await supabase
  .from('calls')
  .select('id, summary, cost, started_at')
  .eq('organization_id', orgId)
  .order('started_at', { ascending: false })
  .limit(50)

// Single row
const { data, error } = await supabase
  .from('tool_configs')
  .select('*, integration:integrations(*)')
  .eq('organization_id', orgId)
  .eq('tool_name', toolName)
  .single()
```
