'use server'

// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates (own AI generation via
// /api/email-templates/generate). Dead code — its only callers
// (src/components/email-marketing/*) are themselves unreachable now that
// every /email-marketing route redirects. Retained deliberately during the
// deprecation window; scheduled for deletion once production data confirms
// no org used the legacy system. Do not build new features against this.
// See .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { EMAIL_SYSTEM_PROMPT, parseGeneratedEmail } from '@/lib/email-marketing/ai-prompt'
import { resolveCopilotProvider } from '@/lib/copilot/resolve-provider'
import { createOpenRouterClient } from '@/lib/llm/openrouter'

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

// ─── Generate full email from prompt ─────────────────────────────────────────

export async function generateEmailFromPrompt(input: {
  prompt: string
  templateName: string
}): Promise<ActionResult<{ templateId: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  if (!input.prompt.trim()) return { ok: false, error: 'prompt_required' }
  if (!input.templateName.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const provider = await resolveCopilotProvider(orgId as string)
  if (!provider) return { ok: false, error: 'ai_not_configured' }

  // ── Call AI provider (OpenRouter, tenant key first / platform key second) ──
  let generated
  try {
    const client = createOpenRouterClient(provider.apiKey)
    const completion = await client.chat.completions.create({
      model: provider.model,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: EMAIL_SYSTEM_PROMPT },
        { role: 'user', content: input.prompt },
      ],
    })

    const text = completion.choices[0]?.message?.content ?? ''
    generated = parseGeneratedEmail(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `ai_error: ${msg}` }
  }

  // ── Persist template + sections ────────────────────────────────────────────
  const { data: template, error: tErr } = await supabase
    .from('email_templates')
    .insert({
      org_id: orgId as string,
      name: input.templateName,
      subject_line: generated.subject_line,
      preview_text: generated.preview_text,
      ai_prompt: input.prompt,
      status: 'draft',
    })
    .select()
    .single()

  if (tErr || !template) return { ok: false, error: tErr?.message ?? 'template_create_failed' }

  const sectionRows = generated.sections.map((s, i) => ({
    template_id: template.id,
    type: s.type,
    name: s.name,
    html_content: s.html_content,
    sort_order: i,
  }))

  const { error: sErr } = await supabase.from('email_template_sections').insert(sectionRows)
  if (sErr) {
    // Roll back template
    await supabase.from('email_templates').delete().eq('id', template.id)
    return { ok: false, error: sErr.message }
  }

  revalidatePath('/email-marketing')
  return { ok: true, data: { templateId: template.id } }
}

// ─── Regenerate a single section ─────────────────────────────────────────────

export async function regenerateSection(input: {
  sectionId: string
  templateId: string
  prompt: string
}): Promise<ActionResult<{ html_content: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const provider = await resolveCopilotProvider(orgId as string)
  if (!provider) return { ok: false, error: 'ai_not_configured' }

  // Fetch current section for context
  const { data: section } = await supabase
    .from('email_template_sections')
    .select('name, type')
    .eq('id', input.sectionId)
    .single()

  const sectionContext = section
    ? `Section type: ${section.type}, Name: "${section.name}".`
    : ''

  let html = ''
  try {
    const client = createOpenRouterClient(provider.apiKey)
    const completion = await client.chat.completions.create({
      model: provider.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: `${EMAIL_SYSTEM_PROMPT}\n\nYou are regenerating a SINGLE email section. Return ONLY the HTML fragment for that section | no JSON wrapper, no code fences.`,
        },
        {
          role: 'user',
          content: `${sectionContext}\n\nGenerate new HTML for this section:\n${input.prompt}`,
        },
      ],
    })
    html = completion.choices[0]?.message?.content?.trim() ?? ''
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `ai_error: ${msg}` }
  }

  // Persist updated content
  const { error } = await supabase
    .from('email_template_sections')
    .update({ html_content: html })
    .eq('id', input.sectionId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { html_content: html } }
}
