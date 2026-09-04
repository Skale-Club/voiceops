// tests/release-gate.test.ts
// Phase 135 Plan 01 (TEST-02/TEST-04): proves the release gate's declared
// membership is honest -- every member file actually exists, every TEST-02
// area is covered by at least one member, and the coverage-pins suite (Task
// 1 of this plan) is wired in. Without this file, deleting a line from
// GATE_MEMBERS in scripts/release-gate.ts would silently shrink coverage
// with no test catching it -- exactly the kind of silent gap this phase
// exists to close.

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GATE_MEMBERS,
  TEST02_AREAS,
  REPO_ROOT,
  getGateTestFiles,
  getUncoveredAreas,
} from '../scripts/release-gate'

describe('release gate: declared membership integrity', () => {
  it('declares at least one member', () => {
    expect(GATE_MEMBERS.length).toBeGreaterThan(0)
  })

  it('every declared member file exists on disk', () => {
    const missing = GATE_MEMBERS.filter((m) => !existsSync(resolve(REPO_ROOT, m.file)))
    expect(missing.map((m) => m.file), 'declared gate member file(s) missing on disk').toEqual([])
  })

  it('every declared member file path is a tests/*.test.ts file (no accidental glob/dir)', () => {
    for (const m of GATE_MEMBERS) {
      expect(m.file, `${m.file} should live under tests/ and be a .test.ts file`).toMatch(/^tests\/.+\.test\.ts$/)
    }
  })

  it('has no duplicate member file entries', () => {
    const files = GATE_MEMBERS.map((m) => m.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('every area on every member is a real TEST02_AREA (typo guard)', () => {
    const validAreas = new Set<string>(TEST02_AREAS)
    for (const m of GATE_MEMBERS) {
      for (const area of m.areas) {
        expect(validAreas.has(area), `"${area}" on ${m.file} is not in TEST02_AREAS`).toBe(true)
      }
    }
  })

  it('every one of the seven TEST-02 areas maps to at least one declared member', () => {
    // This is the assertion that makes deleting a suite a FAILING change
    // instead of a silent shrink: removing the last member for an area
    // (or its `areas` entry) makes this test fail.
    expect(getUncoveredAreas(), 'TEST-02 area(s) with zero declared gate members').toEqual([])
  })

  it('includes tests/coverage-pins.test.ts (Task 1 of 135-01) as a gate member', () => {
    const files = GATE_MEMBERS.map((m) => m.file)
    expect(files).toContain('tests/coverage-pins.test.ts')
  })

  it('getGateTestFiles() returns a deduplicated, non-empty list matching GATE_MEMBERS', () => {
    const files = getGateTestFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(new Set(files).size).toBe(files.length)
    for (const f of files) expect(GATE_MEMBERS.some((m) => m.file === f)).toBe(true)
  })
})

describe('release gate: npm wiring', () => {
  it('package.json declares exactly one release-gate script that runs the runner via tsx', () => {
    const pkgRaw = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> }
    expect(pkg.scripts['release-gate'], 'package.json is missing an npm "release-gate" script').toBeDefined()
    expect(pkg.scripts['release-gate']).toMatch(/tsx\s+scripts\/release-gate\.ts/)
  })
})

describe('release gate: does not silently run the full suite', () => {
  it('the deterministic subset is small relative to the full tests/ directory (sanity bound)', () => {
    // Not a precise count (the tests/ directory grows over time) -- just a
    // guard against someone replacing GATE_MEMBERS with a glob over
    // everything, which the CONTEXT.md constraint explicitly forbids (the
    // full suite has ~30 pre-existing failing files for unrelated reasons).
    expect(getGateTestFiles().length).toBeLessThan(20)
  })
})
