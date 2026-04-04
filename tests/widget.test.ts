// @vitest-environment jsdom
// Phase 4 widget unit tests — RED until src/widget/index.ts is implemented in Plan 02

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

// Helper: evaluate the built widget script in the jsdom environment
// The widget is an IIFE — evaluating it triggers init.
function loadWidget(token: string, scriptSrc: string): void {
  // Set up document.currentScript mock BEFORE evaluating widget
  const scriptEl = document.createElement('script')
  scriptEl.setAttribute('data-token', token)
  scriptEl.src = scriptSrc
  Object.defineProperty(document, 'currentScript', {
    value: scriptEl,
    configurable: true,
    writable: true,
  })

  const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')
  if (!existsSync(WIDGET_PATH)) {
    throw new Error('public/widget.js not found — run npm run build:widget first')
  }
  const code = readFileSync(WIDGET_PATH, 'utf-8')
  // Evaluate widget IIFE in jsdom context
  // eslint-disable-next-line no-eval
  eval(code)
}

describe('Widget — token extraction and init guard (WIDGET-02, WIDGET-04)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    // Remove any existing leaidear-root
    document.getElementById('leaidear-root')?.remove()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('leaidear-root')?.remove()
  })

  it('reads data-token from the script element before any async boundary', () => {
    // Widget must not error when token is present
    expect(() => loadWidget('test-token-123', 'https://example.com/widget.js')).not.toThrow()
  })

  it('creates div#leaidear-root in document.body on init', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    expect(document.getElementById('leaidear-root')).not.toBeNull()
  })

  it('does not create a second leaidear-root if already initialized (double-init guard)', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    loadWidget('test-token-123', 'https://example.com/widget.js')
    const roots = document.querySelectorAll('#leaidear-root')
    expect(roots.length).toBe(1)
  })

  it('does not init if data-token is missing', () => {
    const scriptEl = document.createElement('script')
    scriptEl.src = 'https://example.com/widget.js'
    // No data-token set
    Object.defineProperty(document, 'currentScript', {
      value: scriptEl,
      configurable: true,
      writable: true,
    })
    const WIDGET_PATH = resolve(process.cwd(), 'public', 'widget.js')
    if (!existsSync(WIDGET_PATH)) throw new Error('public/widget.js not found')
    const code = readFileSync(WIDGET_PATH, 'utf-8')
    // eslint-disable-next-line no-eval
    eval(code)
    expect(document.getElementById('leaidear-root')).toBeNull()
  })
})

describe('Widget — session localStorage (WIDGET-05, D-12, D-13)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    document.getElementById('leaidear-root')?.remove()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('leaidear-root')?.remove()
  })

  it('reads existing sessionId from localStorage using leaidear_{token}_sessionId key', () => {
    const token = 'test-token-abc'
    const storageKey = `leaidear_${token}_sessionId`
    localStorage.setItem(storageKey, 'existing-session-uuid')

    // Widget init should not throw even when sessionId exists in localStorage
    expect(() => loadWidget(token, 'https://example.com/widget.js')).not.toThrow()
  })

  it('does not throw when localStorage is inaccessible (private browsing simulation)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError: The operation is insecure.')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError: The operation is insecure.')
    })
    expect(() => loadWidget('test-token-xyz', 'https://example.com/widget.js')).not.toThrow()
  })
})

describe('Widget — Shadow DOM isolation (WIDGET-03, D-01, D-02)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    document.getElementById('leaidear-root')?.remove()
  })

  afterEach(() => {
    document.getElementById('leaidear-root')?.remove()
  })

  it('attaches a shadow root to div#leaidear-root', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    const host = document.getElementById('leaidear-root')
    expect(host).not.toBeNull()
    expect(host!.shadowRoot).not.toBeNull()
  })

  it('renders a style element inside the shadow root (inline CSS, no external sheet)', () => {
    loadWidget('test-token-123', 'https://example.com/widget.js')
    const host = document.getElementById('leaidear-root')!
    const shadow = host.shadowRoot!
    const styles = shadow.querySelectorAll('style')
    expect(styles.length).toBeGreaterThan(0)
  })
})
