#!/usr/bin/env node
// scripts/release-gate.ts
// Phase 135 Plan 01 (TEST-02/TEST-04): the release gate.
//
// `.github/workflows/` has fifteen workflows and none of them run the test
// suite -- build-deploy.yml goes straight from build to deploy. This script
// is the enforcement point TEST-04 requires: a named, deterministic subset
// of tests (never the full suite -- ~30 files fail for pre-existing
// live-database and module-resolution reasons, so a gate over everything
// would be permanently red and therefore ignored) plus `npm run
// workflows:validate`, run together and exiting non-zero on any failure.
//
// GATE_MEMBERS below is the explicit membership list. It is DATA, not a
// glob: removing a suite from this array is a visible diff, and
// tests/release-gate.test.ts separately asserts every TEST02_AREA maps to
// at least one member and that every member file exists on disk, so
// deleting a suite fails the gate/test rather than silently shrinking
// coverage.
//
// This module is safe to `import` from a test file (see
// tests/release-gate.test.ts) -- the CLI entrypoint below only executes
// when this file is run directly, not when its data/helpers are imported.

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// TEST-02 names seven areas. Each must be provable by at least one member
// below (tests/release-gate.test.ts enforces this).
// ---------------------------------------------------------------------------

export const TEST02_AREAS = [
  'Tenant isolation',
  'Direct versus delegated authorization',
  'Cross-agent calls',
  'Cycle and depth limits',
  'Handoff injection resistance',
  'OpenRouter-only generation',
  'Xkedule idempotency',
] as const

export type Test02Area = (typeof TEST02_AREAS)[number]

export interface GateMember {
  /** Path relative to the repo root, passed straight to `vitest run`. */
  file: string
  /**
   * TEST-02 areas this suite proves coverage for. Empty for cross-cutting
   * members (e.g. coverage-pins.test.ts) that are not one of the seven
   * named areas but still gate every release.
   */
  areas: Test02Area[]
}

// ---------------------------------------------------------------------------
// NOTE on tests/security-secdef-isolation.test.ts: it was excluded from this
// list while it failed "get_org_member_profiles refuses to enumerate members
// of a foreign org" -- a real cross-organization data leak, not flakiness.
// Migration 1295 closed it (the function is SECURITY DEFINER and never checked
// whether the caller belongs to the organization it was asked about), the
// migration is applied, and the suite is green. It is a gate member again
// below, because the whole point of a gate is that this cannot regress
// silently a second time.
// ---------------------------------------------------------------------------

export const GATE_MEMBERS: GateMember[] = [
  {
    file: 'tests/security-secdef-isolation.test.ts',
    areas: ['Tenant isolation'],
  },
  {
    file: 'tests/agent-partner-edge-authz.test.ts',
    areas: ['Tenant isolation', 'Direct versus delegated authorization', 'Cross-agent calls'],
  },
  {
    file: 'tests/agent-schema-rls-smoke.test.ts',
    areas: ['Tenant isolation'],
  },
  {
    file: 'tests/agent-delegation.test.ts',
    areas: [
      'Direct versus delegated authorization',
      'Cross-agent calls',
      'Cycle and depth limits',
      'Xkedule idempotency',
    ],
  },
  {
    file: 'tests/agent-handoff-contract.test.ts',
    areas: ['Handoff injection resistance'],
  },
  {
    file: 'tests/openrouter-provider-policy.test.ts',
    areas: ['OpenRouter-only generation'],
  },
  {
    file: 'tests/idempotency-ingress-key.test.ts',
    areas: ['Xkedule idempotency'],
  },
  {
    file: 'tests/vapi-tools-idempotency.test.ts',
    areas: ['Xkedule idempotency'],
  },
  {
    file: 'tests/coverage-pins.test.ts',
    // Cross-cutting: pins the full membership of every safety-critical set
    // (SIDE_EFFECTING_ACTIONS, COMMERCE_WRITE_ACTIONS, partner-edge denial
    // reasons, the channel enum) so a newly added Action Engine action type
    // cannot silently bypass classification the way the Xkedule booking
    // mutations did. Not one of the seven named TEST-02 areas on its own.
    areas: [],
  },
]

/** Deduplicated, ordered list of test files the gate runs. */
export function getGateTestFiles(): string[] {
  return [...new Set(GATE_MEMBERS.map((m) => m.file))]
}

/** Areas from TEST02_AREAS with zero declared members -- should always be []. */
export function getUncoveredAreas(): Test02Area[] {
  const covered = new Set(GATE_MEMBERS.flatMap((m) => m.areas))
  return TEST02_AREAS.filter((area) => !covered.has(area))
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function run(cmd: string, label: string): boolean {
  console.log(`\n▶ ${label}\n  $ ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT })
    console.log(`✓ ${label}`)
    return true
  } catch {
    console.error(`✗ ${label} FAILED`)
    return false
  }
}

function main() {
  console.log('Release gate -- Phase 135 (TEST-02/TEST-03/TEST-04)')
  console.log(`Deterministic subset (${getGateTestFiles().length} files):`)
  for (const f of getGateTestFiles()) console.log(`  - ${f}`)
  console.log(
    'NOTE: tests/security-secdef-isolation.test.ts is a gate member again -- ' +
      'migration 1295 closed the cross-org leak it was failing on.'
  )

  const missing = getGateTestFiles().filter((f) => !existsSync(resolve(REPO_ROOT, f)))
  if (missing.length > 0) {
    console.error(`\nRELEASE GATE: FAILED -- declared member file(s) missing on disk: ${missing.join(', ')}`)
    process.exit(1)
  }

  const uncovered = getUncoveredAreas()
  if (uncovered.length > 0) {
    console.error(`\nRELEASE GATE: FAILED -- TEST-02 area(s) with no declared member: ${uncovered.join(', ')}`)
    process.exit(1)
  }

  const testsOk = run(`npx vitest run ${getGateTestFiles().map((f) => `"${f}"`).join(' ')}`, 'Deterministic test subset')
  const workflowsOk = run('npm run workflows:validate', 'Workflow validation')

  if (!testsOk || !workflowsOk) {
    console.error('\nRELEASE GATE: FAILED')
    process.exit(1)
  }

  console.log('\nRELEASE GATE: PASSED')
  process.exit(0)
}

// Only run the CLI when this file is executed directly (`tsx
// scripts/release-gate.ts`), never when imported -- tests/release-gate.test.ts
// imports GATE_MEMBERS/getGateTestFiles() above and must not trigger a
// recursive gate run merely by loading this module.
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  main()
}
