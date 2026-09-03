/**
 * POST /api/email-templates/generate
 *
 * Generates an EmailDocument JSON from a natural-language brief.
 * Designed to be called by Copilot, MCP, or any internal/external AI agent —
 * NOT by the editor UI directly.
 *
 * Auth: requires a signed-in user with an active org (Supabase session).
 * Provider: resolves via resolveCopilotProvider (org-stored OpenRouter key
 * first, platform OpenRouter key second — Phase 132 MODEL-01/02, no direct
 * Anthropic path).
 *
 * Request body:
 *   {
 *     brief: string,                  // required, what the email should say
 *     audience?: string,              // who reads it
 *     tone?: string,                  // e.g. "friendly", "professional"
 *     goal?: string,                  // e.g. "drive signups", "announce"
 *     brand?: { name?, primaryColor?, logoUrl? },
 *     saveAs?: { name: string },      // if present, also creates a draft template
 *   }
 *
 * Response:
 *   { ok: true, document: EmailDocument, savedTemplateId?: string }
 *   { ok: false, error: string }
 */

import { createClient, getUser } from '@/lib/supabase/server'
import { resolveCopilotProvider } from '@/lib/copilot/resolve-provider'
import { createOpenRouterClient } from '@/lib/llm/openrouter'
import { renderTemplate, type EmailDocument } from '@/lib/email/render-template'
import { sanitizeEmailDocument } from '@/lib/email/sanitize'

export const runtime = 'nodejs'

const SCHEMA_SPEC = `You generate emails as JSON conforming to this exact schema.
Return ONLY a JSON object (no prose, no markdown fences) matching:

{
  "backgroundColor": "#hex",     // page background outside the email body
  "contentWidth": 600,            // px, 560-680 recommended
  "fontFamily": "Arial, sans-serif",
  "sections": [
    {
      "id": "short-random-string",
      "layout": 1 | 2 | 3,                              // column count
      "backgroundColor": "#ffffff",
      "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 },
      "columnsGap": 0,                                  // px, only used when layout > 1
      "columns": [
        // length === layout. Each column is an array of blocks:
        [ Block, Block, ... ]
      ]
    }
  ]
}

Block types (set "blockType" exactly as listed):

1. { "blockType": "heading", "content": "string (plain text or HTML)", "level": 1|2|3, "color": "#hex", "align": "left"|"center"|"right" }
2. { "blockType": "text",    "content": "string (HTML allowed: <strong> <em> <a> <br>)", "fontSize": 15, "color": "#hex", "align": "left"|"center"|"right" }
3. { "blockType": "image",   "src": "https://...", "alt": "string", "width": 600, "link": "https://..." (optional) }
4. { "blockType": "button",  "label": "Call to action", "href": "https://...", "backgroundColor": "#hex", "textColor": "#hex", "borderRadius": 4 }
5. { "blockType": "divider", "color": "#e5e5e5", "thickness": 1 }
6. { "blockType": "spacer",  "height": 24 }
7. { "blockType": "html",    "content": "<raw email-safe HTML>" }  // escape hatch — use sparingly

RULES:
- Output one valid JSON object, nothing else. No markdown fences, no commentary.
- Use email-safe HTML only (no <script>, no <style> blocks, no <video>, no flex/grid).
- Default backgroundColor for the email page: "#f4f4f5". Default content cards: "#ffffff".
- For brand alignment, use the brand.primaryColor on buttons and headings if provided.
- Keep paragraphs short. Lead with the value/offer in the first heading.
- Include at least one Button block when a goal is specified.
- For images, prefer placeholder URLs like https://placehold.co/600x300 if no real asset is provided.
- Avoid columns deeper than 3.
- Section padding defaults: top/bottom 32, left/right 24.
- Always include a closing/footer section (small text + unsubscribe placeholder).`

interface GenerateBody {
  brief?: string
  audience?: string
  tone?: string
  goal?: string
  brand?: { name?: string; primaryColor?: string; logoUrl?: string }
  saveAs?: { name?: string }
}

function makeUserPrompt(body: GenerateBody): string {
  const parts: string[] = []
  parts.push(`BRIEF: ${body.brief}`)
  if (body.audience) parts.push(`AUDIENCE: ${body.audience}`)
  if (body.tone) parts.push(`TONE: ${body.tone}`)
  if (body.goal) parts.push(`GOAL: ${body.goal}`)
  if (body.brand) {
    const b = body.brand
    const bparts: string[] = []
    if (b.name) bparts.push(`name="${b.name}"`)
    if (b.primaryColor) bparts.push(`primaryColor="${b.primaryColor}"`)
    if (b.logoUrl) bparts.push(`logoUrl="${b.logoUrl}"`)
    parts.push(`BRAND: ${bparts.join(', ')}`)
  }
  parts.push('\nGenerate the EmailDocument JSON now.')
  return parts.join('\n')
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  // Strip code fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = fenced ? fenced[1] : trimmed
  return JSON.parse(candidate)
}

function validateDocument(doc: unknown): EmailDocument {
  if (!doc || typeof doc !== 'object') throw new Error('Document must be an object')
  const d = doc as Record<string, unknown>
  if (!Array.isArray(d.sections)) throw new Error('document.sections must be an array')
  for (const [i, s] of d.sections.entries()) {
    if (!s || typeof s !== 'object') throw new Error(`section[${i}] must be an object`)
    const sec = s as Record<string, unknown>
    if (!sec.id || typeof sec.id !== 'string') throw new Error(`section[${i}].id missing`)
    if (![1, 2, 3].includes(sec.layout as number)) throw new Error(`section[${i}].layout must be 1, 2, or 3`)
    if (!Array.isArray(sec.columns)) throw new Error(`section[${i}].columns must be an array`)
    if (sec.columns.length !== sec.layout) {
      throw new Error(`section[${i}].columns.length (${sec.columns.length}) must equal layout (${sec.layout})`)
    }
    for (const [ci, col] of (sec.columns as unknown[]).entries()) {
      if (!Array.isArray(col)) throw new Error(`section[${i}].columns[${ci}] must be an array`)
      for (const [bi, blk] of (col as unknown[]).entries()) {
        if (!blk || typeof blk !== 'object') throw new Error(`section[${i}].columns[${ci}][${bi}] must be an object`)
        const b = blk as Record<string, unknown>
        const valid = ['text', 'heading', 'image', 'button', 'divider', 'spacer', 'html']
        if (!valid.includes(b.blockType as string)) {
          throw new Error(`section[${i}].columns[${ci}][${bi}].blockType invalid: ${b.blockType}`)
        }
      }
    }
  }
  return doc as EmailDocument
}

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return Response.json({ ok: false, error: 'no_active_org' }, { status: 400 })

    let body: GenerateBody
    try {
      body = (await request.json()) as GenerateBody
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    if (!body.brief || typeof body.brief !== 'string' || body.brief.trim().length < 10) {
      return Response.json({ ok: false, error: 'brief_required_min_10_chars' }, { status: 400 })
    }

    const provider = await resolveCopilotProvider(orgId)
    if (!provider) {
      return Response.json(
        { ok: false, error: 'no_ai_provider_configured' },
        { status: 400 },
      )
    }

    // Phase 132 (MODEL-01/02): OpenRouter only — tenant key first, platform
    // key second (resolved above by resolveCopilotProvider).
    const client = createOpenRouterClient(provider.apiKey)

    const completion = await client.chat.completions.create({
      model: provider.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SCHEMA_SPEC },
        { role: 'user', content: makeUserPrompt(body) },
      ],
    })

    const text = completion.choices[0]?.message?.content
    if (!text) {
      return Response.json({ ok: false, error: 'ai_returned_no_text' }, { status: 502 })
    }

    let parsed: unknown
    try {
      parsed = extractJson(text)
    } catch (e) {
      return Response.json(
        { ok: false, error: 'ai_returned_invalid_json', raw: text },
        { status: 502 },
      )
    }

    let document: EmailDocument
    try {
      document = validateDocument(parsed)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown_validation_error'
      return Response.json(
        { ok: false, error: `validation_failed: ${msg}`, document: parsed },
        { status: 502 },
      )
    }

    // AI output is not trustworthy any more than user input is — sanitize
    // before it's ever saved or handed back to the caller.
    document = sanitizeEmailDocument(document)

    // Optionally save as draft template
    let savedTemplateId: string | undefined
    if (body.saveAs?.name && body.saveAs.name.trim()) {
      const { html, plainText } = renderTemplate(document)
      const { data, error } = await supabase
        .from('email_templates')
        .insert({
          org_id: orgId,
          name: body.saveAs.name.trim(),
          document,
          html_snapshot: html,
          plain_text_snapshot: plainText,
          status: 'draft',
          created_by: user.id,
        })
        .select('id')
        .single()
      if (!error && data) savedTemplateId = data.id as string
    }

    return Response.json({
      ok: true,
      document,
      savedTemplateId,
      usage: {
        input_tokens: completion.usage?.prompt_tokens ?? 0,
        output_tokens: completion.usage?.completion_tokens ?? 0,
        model: provider.model,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
