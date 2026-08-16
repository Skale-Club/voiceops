// Playwright-based website extractor for the Active Prospect System.
// Runs headless Chromium to screenshot + audit a business website.
// NOTE: Playwright must be installed: npm install playwright
//       And Chromium must be available: npx playwright install chromium
//       In Docker: add --no-sandbox flag (already set below) + install deps.

// playwright and cheerio are loaded dynamically so this module can be
// imported (and GET /analyze routes can respond) even when the packages
// are not yet available in the standalone output. The actual browser
// and parser are only needed when analyzeWebsite() is called.
import type { BrandColor, RawExtraction } from './types'
import { discoverBooking, type BookingCandidate } from './booking-discovery'

const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const MOBILE_VIEWPORT  = { width: 390, height: 844 }
const PAGE_TIMEOUT_MS  = 30_000
const NAV_TIMEOUT_MS   = 45_000

/** Normalise a URL — add https:// if scheme is missing. */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** Convert rgb(r,g,b) / rgba(r,g,b,a) to #rrggbb. Returns null on failure. */
export function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return null
  const [, r, g, b] = match
  return (
    '#' +
    [r, g, b]
      .map((v) => parseInt(v, 10).toString(16).padStart(2, '0'))
      .join('')
  )
}

/** Convert raw color samples into deduped BrandColor entries, preserving first-seen order. */
export function toBrandColors(samples: Array<{ value: string; role: string }>): BrandColor[] {
  const seen = new Set<string>()
  const colors: BrandColor[] = []

  for (const { value, role } of samples) {
    const hex = rgbToHex(value)
    if (hex && !seen.has(hex)) {
      seen.add(hex)
      colors.push({ hex, role: role as BrandColor['role'] })
    }
  }

  return colors
}

/** Extract brand colors from a live page using JS evaluation. */
async function extractColors(page: import('playwright').Page): Promise<{ colors: BrandColor[]; cssVars: Record<string, string> }> {
  const raw = await page.evaluate(() => {
    const cssVars: Record<string, string> = {}
    const colorValues: Array<{ value: string; role: string }> = []

    // Harvest CSS custom properties from :root
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
            for (const prop of rule.style) {
              const v = rule.style.getPropertyValue(prop).trim()
              if (prop.startsWith('--') && v) cssVars[prop] = v
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip just this one
      }
    }

    // Sample computed colors from key structural elements
    const samples: Array<[string, string]> = [
      ['header, nav, .navbar, .header', 'background'],
      ['header, nav, .navbar, .header', 'text'],
      ['h1, h2', 'text'],
      ['.btn, .button, [class*="btn"], [class*="cta"]', 'accent'],
      ['body', 'background'],
    ]
    for (const [selector, role] of samples) {
      const el = document.querySelector(selector) as HTMLElement | null
      if (!el) continue
      const cs = window.getComputedStyle(el)
      const prop = role === 'background' ? 'backgroundColor' : 'color'
      const val = cs[prop as keyof CSSStyleDeclaration] as string
      if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
        colorValues.push({ value: val, role })
      }
    }

    return { cssVars, colorValues }
  })

  return { colors: toBrandColors(raw.colorValues), cssVars: raw.cssVars }
}

/** Extract logo URL from a live page. */
async function extractLogo(page: import('playwright').Page, baseUrl: string): Promise<string | null> {
  return page.evaluate((base) => {
    const selectors = [
      'img[src*="logo" i]',
      'img[alt*="logo" i]',
      'img[class*="logo" i]',
      'a[href="/"] img',
      'header img:first-of-type',
      'nav img:first-of-type',
      '.logo img',
      '.brand img',
      '.site-logo img',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLImageElement | null
      if (el?.src) {
        try {
          return new URL(el.src, base).href
        } catch {
          return el.src
        }
      }
    }
    return null
  }, baseUrl)
}

/** Parse headings, nav items and hero text with cheerio. */
async function extractContent(html: string): Promise<{ headings: string[]; navItems: string[]; heroText: string[] }> {
  const cheerio = await import('cheerio')
  const $ = cheerio.load(html)

  const headings: string[] = []
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim()
    if (text.length >= 3 && text.length <= 120) headings.push(text)
  })

  const navItems: string[] = []
  const navSeen = new Set<string>()
  $('nav a, header a, .navbar a, .nav a').each((_, el) => {
    const text = $(el).text().trim()
    if (text.length >= 2 && text.length <= 60 && !navSeen.has(text.toLowerCase())) {
      navSeen.add(text.toLowerCase())
      navItems.push(text)
    }
  })

  const heroText: string[] = []
  const heroSeen = new Set<string>()
  $('h1, .hero p, .hero-text, .tagline, .subtitle, [class*="hero"] p, [class*="banner"] p').each((_, el) => {
    const text = $(el).text().trim()
    if (text.length >= 10 && text.length <= 400 && !heroSeen.has(text)) {
      heroSeen.add(text)
      heroText.push(text)
    }
  })

  return {
    headings: headings.slice(0, 10),
    navItems: navItems.slice(0, 15),
    heroText: heroText.slice(0, 5),
  }
}

/** Calculate lead score: higher = site has more problems → better prospect.
 *
 * A business with a slow, non-responsive, logo-less, outdated site is a GREAT
 * target for the "we built you a better version" pitch.
 */
export function calculateLeadScore(data: {
  siteReachable: boolean
  isMobileResponsive: boolean
  hasLogo: boolean
  hasCTA: boolean
  hasContactInfo: boolean
  loadMs: number
  hasCSSVars: boolean   // modern CSS custom properties → more modern site
  colorCount: number    // low count → possibly unstyled / very basic
}): number {
  if (!data.siteReachable) return 0

  let score = 25 // base: they have a site

  // Opportunity signals (problems = higher score)
  if (!data.isMobileResponsive) score += 20
  if (!data.hasLogo)            score += 10
  if (!data.hasCTA)             score += 15
  if (!data.hasCSSVars)         score += 10   // likely old site
  if (data.colorCount < 2)      score += 5    // unstyled
  if (data.loadMs > 4000)       score += 10
  if (data.hasContactInfo)      score += 5    // they're reachable

  return Math.min(score, 100)
}

/** Navigate resiliently. `networkidle` hangs on sites with persistent trackers,
 *  chat widgets, or analytics polling — which is most small-business sites — and
 *  causes spurious 45s timeouts. Instead: load the DOM (reliable), then make a
 *  best-effort, capped wait for the network to settle so dynamic content renders
 *  before the screenshot. Never throws on the settle/paint waits.
 *
 *  Returns the REAL page load time (navigation start → DOMContentLoaded). The
 *  caller must use this, NOT wall-clock around resilientGoto — that would also
 *  count the browser launch and the artificial settle/paint waits, inflating
 *  loadMs to 10–16s and making every site look "slow". */
async function resilientGoto(page: import('playwright').Page, url: string): Promise<number> {
  const navStart = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  const loadMs = Date.now() - navStart
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(1_500) // let above-the-fold imagery paint (not counted in loadMs)
  return loadMs
}

/** Run full Playwright analysis on a URL. */
export async function analyzeWebsite(rawUrl: string): Promise<RawExtraction> {
  const url = normaliseUrl(rawUrl)

  // Dynamic import — loaded here (not at module top-level) so that GET
  // requests to /analyze can succeed even if playwright is unavailable.
  const { chromium } = await import('playwright')

  // In Docker (Alpine), use the system Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
  // In local dev, leave executablePath undefined so Playwright uses its own bundled binary.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--ignore-certificate-errors', // many small-business sites have expired/self-signed certs
    ],
  })

  try {
    // ── Desktop pass ──────────────────────────────────────────────────────────
    const desktopCtx = await browser.newContext({
      viewport: DESKTOP_VIEWPORT,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    const desktopPage = await desktopCtx.newPage()
    desktopPage.setDefaultTimeout(PAGE_TIMEOUT_MS)

    const loadMs = await resilientGoto(desktopPage, url)
    const resolvedUrl = desktopPage.url()
    const pageTitle = await desktopPage.title()

    const desktopScreenshot = await desktopPage.screenshot({ type: 'jpeg', quality: 80, fullPage: false })
    const html = await desktopPage.content()

    const { colors: brandColors, cssVars: rawCssVars } = await extractColors(desktopPage)
    const logoUrl = await extractLogo(desktopPage, resolvedUrl)

    const bookingCandidates = await desktopPage.evaluate(() => {
      const candidates: Array<{ url: string; label?: string; source: 'link' | 'iframe' | 'form' }> = []
      const add = (raw: string | null, label: string | null, source: 'link' | 'iframe' | 'form') => {
        if (!raw) return
        try {
          candidates.push({
            url: new URL(raw, document.baseURI).href,
            label: label?.replace(/\s+/g, ' ').trim().slice(0, 160) || undefined,
            source,
          })
        } catch {
          // Ignore malformed and non-navigation URLs.
        }
      }
      document.querySelectorAll('a[href]').forEach((node) => {
        const element = node as HTMLAnchorElement
        add(element.getAttribute('href'), element.innerText || element.getAttribute('aria-label'), 'link')
      })
      document.querySelectorAll('iframe[src]').forEach((node) => {
        const element = node as HTMLIFrameElement
        add(element.getAttribute('src'), element.title, 'iframe')
      })
      document.querySelectorAll('form[action]').forEach((node) => {
        const element = node as HTMLFormElement
        add(element.getAttribute('action'), element.getAttribute('aria-label'), 'form')
      })
      return candidates.slice(0, 300)
    }) as BookingCandidate[]
    const booking = discoverBooking(resolvedUrl, bookingCandidates)

    // Detect mobile responsiveness via viewport meta tag
    const isMobileResponsive = await desktopPage.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]')
      return meta !== null && (meta.getAttribute('content') ?? '').includes('width=device-width')
    })

    // Detect CTA
    const hasClearlyCTA = await desktopPage.evaluate(() => {
      const ctaSels = ['[class*="cta"]', '[class*="btn"]', '.button', 'button[type="submit"]', 'a[href*="contact"]', 'a[href*="get-started"]', 'a[href*="signup"]', 'a[href*="book"]', 'a[href*="appointment"]', 'a[href*="schedule"]', 'a[href*="reserve"]']
      const bookingText = /\b(book(?:ing)?|appointment|schedule|reserve|agendar|agendamento|marcar|reservar)\b/i
      return ctaSels.some((s) => document.querySelector(s) !== null) ||
        Array.from(document.querySelectorAll('a, button')).some((node) => bookingText.test(node.textContent ?? ''))
    })

    // Detect contact info
    const hasContactInfo = await desktopPage.evaluate(() => {
      const body = document.body.innerText
      return /(\+?[\d\s\-().]{7,}|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b)/.test(body)
    })

    await desktopCtx.close()

    // ── Mobile screenshot ─────────────────────────────────────────────────────
    const mobileCtx = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    })
    const mobilePage = await mobileCtx.newPage()
    mobilePage.setDefaultTimeout(PAGE_TIMEOUT_MS)
    await resilientGoto(mobilePage, url)
    const mobileScreenshot = await mobilePage.screenshot({ type: 'jpeg', quality: 80, fullPage: false })
    await mobileCtx.close()

    const { headings, navItems, heroText } = await extractContent(html)

    return {
      resolvedUrl,
      pageTitle,
      loadMs,
      isMobileResponsive,
      hasClearlyCTA,
      hasContactInfo,
      brandColors,
      logoUrl,
      headings,
      navItems,
      heroText,
      booking,
      desktopScreenshot,
      mobileScreenshot,
      rawCssVars,
    }
  } finally {
    await browser.close()
  }
}
