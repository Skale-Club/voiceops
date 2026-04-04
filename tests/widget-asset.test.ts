import { existsSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'

const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')

describe('Widget asset — public/widget.js', () => {
  it('exists at public/widget.js', () => {
    expect(existsSync(WIDGET_PATH)).toBe(true)
  })

  it('is a non-empty file (not the Phase 1 stub after build:widget)', () => {
    expect(existsSync(WIDGET_PATH)).toBe(true)
    const stat = statSync(WIDGET_PATH)
    expect(stat.size).toBeGreaterThan(100)
  })

  it('contains the leaidear namespace string (survives esbuild minification)', () => {
    expect(existsSync(WIDGET_PATH)).toBe(true)
    const content = readFileSync(WIDGET_PATH, 'utf-8')
    // 'leaidear_' appears in the localStorage key: `leaidear_${token}_sessionId`
    // 'leaidear-root' appears as the Shadow DOM host element ID
    // Both survive --minify because esbuild only minifies identifiers, not string literals
    expect(content).toMatch(/leaidear[_-]/)
  })
})
