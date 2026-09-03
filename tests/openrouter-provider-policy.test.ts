// tests/openrouter-provider-policy.test.ts
// Phase 132 Plan 04 (MODEL-01, MODEL-02): static drift guard proving every
// Xphere-owned generative call is reached through OpenRouter (tenant key
// first, platform key second) and never through a direct Anthropic client.
//
// The guard scans actual generative CLIENT CONSTRUCTION (`new Anthropic(`,
// `new OpenAI(`), never SDK imports — Anthropic.Tool/MessageParam etc. remain
// widely used as pure types (src/lib/flows/ai-tools.ts,
// src/lib/chat/stream/tool-schemas.ts, src/lib/copilot/tools/types.ts) and
// must not false-positive here. See 132-PROVIDER-DRIFT-INVENTORY.md for the
// verified violation list this guard was written against.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC_ROOT = join(process.cwd(), 'src')

// Phase 132 (MODEL-02): the ONLY sanctioned direct-OpenAI-compatible client
// construction outside the OpenRouter factory — embedding infrastructure.
// Changing its model/base URL would change vector dimensionality and require
// a full knowledge-base reindex, which is explicitly out of scope.
const EMBEDDING_EXCEPTION_FILES = new Set(['src/lib/knowledge/embed.ts'])

const SKIP_DIR_NAMES = new Set(['node_modules', '.next', '.git'])

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, files)
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

function toRelative(absPath: string): string {
  return relative(process.cwd(), absPath).split('\\').join('/')
}

describe('OpenRouter-only generative provider policy (drift guard)', () => {
  const files = walk(SRC_ROOT)

  it('never constructs a direct generative Anthropic client anywhere in src/', () => {
    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      if (/new\s+Anthropic\s*\(/.test(content)) {
        offenders.push(toRelative(file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('allows Anthropic SDK type-only imports without flagging them as construction', () => {
    // These three files are named in 132-PROVIDER-DRIFT-INVENTORY.md as
    // type-only imports (tool schema shapes). They must keep importing the
    // SDK for types, and must never construct a client.
    const typeOnlyFiles = [
      'src/lib/flows/ai-tools.ts',
      'src/lib/chat/stream/tool-schemas.ts',
      'src/lib/copilot/tools/types.ts',
    ]
    for (const rel of typeOnlyFiles) {
      const full = join(process.cwd(), rel)
      expect(existsSync(full)).toBe(true)
      const content = readFileSync(full, 'utf8')
      expect(content).toMatch(/import\s+type\s+Anthropic\s+from\s+['"]@anthropic-ai\/sdk['"]/)
      expect(content).not.toMatch(/new\s+Anthropic\s*\(/)
    }
  })

  it('every new OpenAI( construction is the documented embedding exception or paired with the OpenRouter base URL', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = toRelative(file)
      if (EMBEDDING_EXCEPTION_FILES.has(rel)) continue
      const content = readFileSync(file, 'utf8')
      const regex = /new\s+OpenAI\s*\(/g
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        const windowText = content.slice(match.index, match.index + 400)
        const hasOpenRouterBaseUrl = /openrouter\.ai|OPENROUTER_BASE_URL/.test(windowText)
        if (!hasOpenRouterBaseUrl) {
          offenders.push(`${rel}@${match.index}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('documents the sanctioned embedding exception explicitly, unchanged model/vector contract', () => {
    const content = readFileSync(join(process.cwd(), 'src/lib/knowledge/embed.ts'), 'utf8')
    expect(content).toContain('text-embedding-3-small')
    expect(content).toMatch(/OpenAI-compatible/i)
  })

  it('every previously-inventoried violation site no longer constructs a direct Anthropic client', () => {
    // 132-PROVIDER-DRIFT-INVENTORY.md verified violation list (supersedes the
    // plan/context file lists). src/lib/chat/stream/anthropic.ts was fully
    // orphaned dead code and may be deleted outright — trivially compliant.
    const inventoried = [
      'src/app/api/ads/memories/extract/route.ts',
      'src/app/(dashboard)/workflows/flows/_actions/ai-build.ts',
      'src/app/(dashboard)/email-marketing/_actions/generate.ts',
      'src/app/api/email-templates/generate/route.ts',
      'src/lib/knowledge/query-knowledge.ts',
      'src/lib/chat/stream/anthropic.ts',
      'src/lib/copilot/run-turn.ts',
    ]
    for (const rel of inventoried) {
      const full = join(process.cwd(), rel)
      if (!existsSync(full)) continue
      const content = readFileSync(full, 'utf8')
      expect(content).not.toMatch(/new\s+Anthropic\s*\(/)
      expect(content).not.toMatch(/import\s+Anthropic\s+from\s+['"]@anthropic-ai\/sdk['"]/)
    }
  })

  it('src/lib/llm/openrouter.ts exposes one tenant-first/platform-fallback resolver + factory', () => {
    const content = readFileSync(join(process.cwd(), 'src/lib/llm/openrouter.ts'), 'utf8')
    expect(content).toContain('OPENROUTER_BASE_URL')
    expect(content).toMatch(/export (async )?function resolveOpenRouterCredential/)
    expect(content).toMatch(/export function createOpenRouterClient/)
  })
})
