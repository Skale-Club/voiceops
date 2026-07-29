/**
 * Xphere Reviews Widget | embeddable IIFE bundle.
 *
 * Usage (recommended | iframe):
 *   <iframe src="https://xphere.app/widget/reviews/{token}?layout=grid&min_rating=4"
 *           width="100%" height="640" frameborder="0"></iframe>
 *
 * Or directly inline via the script bundle:
 *   <div id="operator-reviews"
 *        data-token="..."
 *        data-layout="grid"
 *        data-theme="light"
 *        data-min-rating="4"
 *        data-limit="12"></div>
 *   <script src="https://xphere.app/reviews-widget.js" defer></script>
 *
 * Reads its config from either:
 *   1. The query string when running inside an iframe (?token=...&layout=...)
 *   2. The closest [data-token] element on the host page
 */

export {}

interface ApiPayload {
  business: {
    name: string | null
    address: string | null
    placeId: string | null
    averageRating: number | null
    totalReviewsCount: number | null
    lastScrapedAt: string | null
  }
  brand?: {
    accent?: string | null
  }
  settings?: {
    layout?: Layout
    theme?: Theme
    minRating?: number
    limit?: number
    showHero?: boolean
    equalHeight?: boolean
    footerCta?: boolean
    showOwnerResponse?: boolean
    maxChars?: number
  }
  distribution: { rating: number; count: number }[]
  reviews: ReviewItem[]
  total: number
}

interface ReviewItem {
  id: string
  reviewerName: string | null
  reviewerPhotoUrl: string | null
  reviewerProfileUrl: string | null
  rating: number
  text: string | null
  dateText: string | null
  dateIso: string | null
  isLocalGuide: boolean
  helpfulCount: number
  ownerResponse: string | null
  ownerResponseDate: string | null
  photos: { url: string; width: number | null; height: number | null }[]
}

type Layout = 'grid' | 'list' | 'carousel'
type Theme = 'light' | 'dark'
type Sort = 'recent' | 'rating_high' | 'helpful'

interface WidgetConfig {
  token: string
  layout: Layout
  theme: Theme
  minRating: number
  sort: Sort
  limit: number
  apiBase: string
  showHero: boolean
  equalHeight: boolean
  footerCta: boolean
  showOwnerResponse: boolean
  maxChars: number
}

const DEFAULTS: Omit<WidgetConfig, 'token'> = {
  layout: 'carousel',
  theme: 'light',
  minRating: 4,
  sort: 'recent',
  limit: 12,
  apiBase: '',
  showHero: true,
  equalHeight: true,
  footerCta: false,
  showOwnerResponse: true,
  maxChars: 220,
}

const CSS = `
.orw-root {
  color-scheme: light dark;
  --orw-bg: transparent;
  --orw-card: #ffffff;
  --orw-text: #18181b;
  --orw-muted: #6b7280;
  --orw-border: rgba(24, 24, 27, 0.10);
  --orw-shadow: 0 10px 30px rgba(24, 24, 27, 0.06);
  --orw-brand: #6366f1;
  --orw-brand-soft: rgba(99, 102, 241, 0.12);
  --orw-star: #f59e0b;
  --orw-radius: 18px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--orw-text);
}
.orw-root[data-theme="dark"] {
  --orw-bg: transparent;
  --orw-card: #161616;
  --orw-text: #f5f5f4;
  --orw-muted: #a1a1aa;
  --orw-border: rgba(245, 245, 244, 0.10);
  --orw-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  --orw-brand-soft: rgba(99, 102, 241, 0.20);
}
.orw-root *, .orw-root *::before, .orw-root *::after { box-sizing: border-box; }

.orw-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 24px;
  border-radius: var(--orw-radius);
  background: linear-gradient(135deg, var(--orw-brand-soft), #ffffff 80%);
  border: 1px solid var(--orw-border);
  margin-bottom: 20px;
  user-select: none; -webkit-user-select: none;
}
.orw-root[data-theme="dark"] .orw-hero {
  background: linear-gradient(135deg, var(--orw-brand-soft), #161616 80%);
}
.orw-hero-rating { display: flex; align-items: baseline; gap: 12px; }
.orw-hero-rating-num {
  font-size: 56px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.orw-hero-meta { font-size: 13px; color: var(--orw-muted); }
.orw-hero-name { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
.orw-hero-text { flex: 1; min-width: 220px; }

.orw-dist { display: flex; flex-direction: column; gap: 6px; min-width: 240px; flex: 1; }
.orw-dist-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.orw-dist-label { width: 32px; color: var(--orw-muted); display: inline-flex; align-items: center; gap: 2px; }
.orw-dist-bar { flex: 1; height: 8px; background: var(--orw-border); border-radius: 999px; overflow: hidden; }
.orw-dist-fill { height: 100%; background: var(--orw-brand); border-radius: 999px; transition: width 600ms ease; }
.orw-dist-count { width: 40px; text-align: right; color: var(--orw-muted); font-variant-numeric: tabular-nums; }

.orw-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.orw-list { display: flex; flex-direction: column; gap: 14px; }
.orw-carousel-wrap { position: relative; }
/* Pull the footer back up by exactly the shadow allowance added below, so the
   card->CTA gap stays 32px. Scoped with :has() on purpose: with no footer there
   is nothing to pull up, and the document must instead END 48px lower so the
   shadow still has somewhere to paint inside the iframe. */
.orw-carousel-wrap:has(+ .orw-footer-cta) { margin-bottom: -48px; }
.orw-carousel-viewport {
  overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
  -webkit-overflow-scrolling: touch; cursor: grab;
  /* This scroller CLIPS ON BOTH AXES: declaring overflow-x as auto makes
     overflow-y compute to auto as well (CSS Overflow — a 'visible' axis becomes
     'auto' when the other axis is not visible). So the card shadow only survives
     if it fits INSIDE this box.

     --orw-shadow reaches 40px below a card (0 10px 30px) and :hover reaches 56px
     (0 16px 40px), but this padding used to be 8px — the shadow was sliced off
     flat. Now: 8px of real gap + 48px of shadow room = 56px, with an equal -48px
     pulled back on .orw-carousel-wrap above.

     PARITY WITH THE DASHBOARD PREVIEW IS ON THE GAP, NOT ON THIS NUMBER. The
     card->CTA gap stays 8 + 24 (footer margin) = 32px, matching the preview's
     pb-2. Do not "resync" this to the preview's 8px — the preview's card uses
     Tailwind shadow-sm (~3px reach), which fits in 8px; this one does not. That
     mismatch is what silently clipped the live widget.

     The left gutter stays 16px. The horizontal shadow (30px blur, no x-offset)
     is still partly clipped and deliberately left alone: .orw-root has no
     padding, so a negative horizontal margin would push the scroller outside the
     document and give the iframe a horizontal scrollbar. The left edge already
     covers 16 of the 30px, and the right edge is where cards scroll out of view,
     so the visible cost is small — fixing it properly needs root padding. */
  padding: 0 0 56px 16px;
  scroll-padding-left: 16px;
  user-select: none; -webkit-user-select: none;
}
.orw-carousel-viewport::-webkit-scrollbar { display: none; }
.orw-carousel-viewport.orw-dragging { cursor: grabbing; scroll-snap-type: none; }
.orw-carousel-track { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(280px, 76%); gap: 16px; }
.orw-carousel-track .orw-card { scroll-snap-align: start; }

/* Equal-height mode: cards stretch to the tallest in their row */
.orw-eqh .orw-grid .orw-card,
.orw-eqh .orw-carousel-track .orw-card { height: 100%; }
.orw-carousel-btn {
  position: absolute; top: 50%; transform: translateY(-50%);
  z-index: 10; width: 38px; height: 38px; border-radius: 50%;
  border: 1px solid var(--orw-border); background: var(--orw-card); color: var(--orw-text);
  font-size: 22px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 12px rgba(0,0,0,0.10);
  transition: opacity 250ms ease, transform 200ms ease, box-shadow 200ms ease;
  padding: 0;
}
.orw-carousel-btn:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.18); transform: translateY(-50%) scale(1.08); }
.orw-carousel-btn[disabled] { opacity: 0.35; pointer-events: none; }
.orw-carousel-prev { left: 6px; }
.orw-carousel-next { right: 6px; }

.orw-card {
  background: var(--orw-card);
  border: 1px solid var(--orw-border);
  border-radius: var(--orw-radius);
  padding: 18px;
  box-shadow: var(--orw-shadow);
  display: flex; flex-direction: column; gap: 10px;
  transition: transform 200ms ease, box-shadow 200ms ease;
}
.orw-card:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(24,24,27,0.10); }

.orw-card-head { display: flex; align-items: center; gap: 10px; }
.orw-avatar {
  width: 40px; height: 40px; border-radius: 999px; overflow: hidden;
  background: var(--orw-brand-soft); color: var(--orw-brand);
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px;
}
.orw-avatar img { width: 100%; height: 100%; object-fit: cover; }
.orw-name { font-weight: 600; font-size: 14px; line-height: 1.2; }
.orw-name a { color: inherit; text-decoration: none; }
.orw-name a:hover { text-decoration: underline; }
.orw-meta-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--orw-muted); margin-top: 2px; }

.orw-stars { display: inline-flex; gap: 2px; }
.orw-star { width: 14px; height: 14px; flex: none; }
.orw-star-empty { fill: rgba(245, 158, 11, 0.20); }
.orw-star-full  { fill: var(--orw-star); }

.orw-text {
  font-size: 14px; line-height: 1.55; margin: 0; color: var(--orw-text);
  white-space: pre-line;
}
.orw-more {
  align-self: flex-start; background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--orw-brand); font-size: 12px; font-weight: 600;
}

.orw-photos { display: flex; flex-wrap: wrap; gap: 6px; }
.orw-photo {
  width: 72px; height: 72px; border-radius: 10px; overflow: hidden; cursor: zoom-in;
  border: 1px solid var(--orw-border); background: var(--orw-border);
}
.orw-photo img { width: 100%; height: 100%; object-fit: cover; transition: transform 250ms ease; }
.orw-photo:hover img { transform: scale(1.08); }

.orw-owner {
  margin-top: 4px;
  border-left: 3px solid var(--orw-brand);
  background: var(--orw-brand-soft);
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
}
.orw-owner-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--orw-brand); font-weight: 700;
}
.orw-owner-text { margin: 4px 0 0; line-height: 1.5; }

.orw-write-btn {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 16px;
  padding: 9px 20px; border-radius: 999px;
  background: var(--orw-brand); color: #fff;
  font-size: 13px; font-weight: 600; text-decoration: none;
  border: none; cursor: pointer; white-space: nowrap;
  transition: opacity 180ms ease, transform 180ms ease, box-shadow 180ms ease;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15);
}
.orw-write-btn:hover { opacity: 0.88; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.20); }
.orw-footer-cta { display: flex; justify-content: center; margin-top: 24px; }
/* The button's own 16px top margin is for the hero context; inside the footer
   the 24px above already sets the gap, so zero it to match the preview (which
   puts no margin on the footer button). Card->button stays 8 + 24 = 32px. */
.orw-footer-cta .orw-write-btn { margin-top: 0; }

.orw-empty {
  padding: 40px 20px; text-align: center; color: var(--orw-muted); font-size: 14px;
  border: 1px dashed var(--orw-border); border-radius: var(--orw-radius);
}

.orw-lightbox {
  position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center; padding: 32px;
  opacity: 0; pointer-events: none; transition: opacity 200ms ease;
}
.orw-lightbox.open { opacity: 1; pointer-events: auto; }
.orw-lightbox img { max-width: 100%; max-height: 100%; border-radius: 12px; box-shadow: 0 30px 80px rgba(0,0,0,0.4); }
.orw-lightbox-close {
  position: absolute; top: 18px; right: 18px; background: white; color: black;
  border: 0; border-radius: 999px; width: 36px; height: 36px; font-size: 20px; cursor: pointer;
}

.orw-google-badge { margin-left: auto; flex-shrink: 0; display: flex; align-items: center; }

@media (max-width: 540px) {
  .orw-hero-rating-num { font-size: 44px; }
  .orw-grid { grid-template-columns: 1fr; }
}

/* ── Continuous marquee carousel ─────────────────────────────────── */
@keyframes orw-marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(var(--orw-marquee-end, -50%)); }
}
.orw-carousel-viewport.orw-auto {
  overflow: hidden;
  cursor: default;
  /* Deliberately does NOT reset padding-bottom. It used to zero it, which made
     the marquee mode clip card shadows even harder than the manual carousel;
     inheriting the 56px allowance keeps both modes identical (and the -48px pull
     on .orw-carousel-wrap applies to both). */
}
.orw-carousel-viewport.orw-auto .orw-carousel-track {
  display: flex;
  flex-wrap: nowrap;
  width: max-content;
  gap: 16px;
  grid-auto-flow: unset;
  grid-auto-columns: unset;
}
.orw-carousel-viewport.orw-auto .orw-card {
  flex: none;
  width: 300px;
  max-height: 380px;
  overflow: hidden;
  cursor: default;
}
/* hide scroll-snap in marquee mode */
.orw-carousel-viewport.orw-auto { scroll-snap-type: none; }
`

const GOOGLE_G_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" aria-label="Google review" role="img"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`

const STAR_PATH =
  'M12 2.5l2.95 6.0 6.62.96-4.79 4.66 1.13 6.59L12 17.77 6.09 20.71 7.22 14.12 2.43 9.46 9.05 8.5z'

function svgStar(filled: boolean): string {
  const cls = filled ? 'orw-star orw-star-full' : 'orw-star orw-star-empty'
  return `<svg class="${cls}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`
}

function stars(rating: number): string {
  const out: string[] = []
  for (let i = 1; i <= 5; i++) out.push(svgStar(rating >= i))
  return `<span class="orw-stars" role="img" aria-label="${rating} of 5 stars">${out.join('')}</span>`
}

function initials(name: string | null): string {
  if (!name) return '·'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getConfig(): WidgetConfig | null {
  // 1) iframe / standalone page: read from query string
  const sp = new URLSearchParams(window.location.search)
  if (sp.has('token')) {
    return {
      token: sp.get('token')!,
      layout: (sp.get('layout') as Layout) || DEFAULTS.layout,
      theme: (sp.get('theme') as Theme) || DEFAULTS.theme,
      minRating: Number.parseInt(sp.get('min_rating') ?? '1', 10) || DEFAULTS.minRating,
      sort: (sp.get('sort') as Sort) || DEFAULTS.sort,
      limit: Number.parseInt(sp.get('limit') ?? '12', 10) || DEFAULTS.limit,
      apiBase: sp.get('api') ?? window.location.origin,
      showHero: sp.get('hero') !== '0',
      equalHeight: sp.get('eqh') !== '0',
      footerCta: sp.get('cta') === '1',
      showOwnerResponse: DEFAULTS.showOwnerResponse,
      maxChars: DEFAULTS.maxChars,
    }
  }

  // 2) inline script bundle: find first [data-token] element
  const host = document.querySelector<HTMLElement>('[data-operator-reviews][data-token], #operator-reviews[data-token]')
  if (!host) return null
  return {
    token: host.dataset.token!,
    layout: ((host.dataset.layout as Layout) || DEFAULTS.layout) as Layout,
    theme: ((host.dataset.theme as Theme) || DEFAULTS.theme) as Theme,
    minRating: Number.parseInt(host.dataset.minRating ?? '1', 10) || DEFAULTS.minRating,
    sort: ((host.dataset.sort as Sort) || DEFAULTS.sort) as Sort,
    limit: Number.parseInt(host.dataset.limit ?? '12', 10) || DEFAULTS.limit,
    apiBase: host.dataset.api ?? new URL((document.currentScript as HTMLScriptElement | null)?.src ?? window.location.href).origin,
    showHero: host.dataset.hero !== '0',
    equalHeight: host.dataset.equalHeight !== '0',
    footerCta: host.dataset.footerCta === '1',
    showOwnerResponse: DEFAULTS.showOwnerResponse,
    maxChars: DEFAULTS.maxChars,
  }
}

function withSavedSettings(config: WidgetConfig, settings: ApiPayload['settings']): WidgetConfig {
  if (!settings) return config
  return {
    ...config,
    layout: settings.layout ?? config.layout,
    theme: settings.theme ?? config.theme,
    minRating: settings.minRating ?? config.minRating,
    limit: settings.limit ?? config.limit,
    showHero: settings.showHero ?? config.showHero,
    equalHeight: settings.equalHeight ?? config.equalHeight,
    footerCta: settings.footerCta ?? config.footerCta,
    showOwnerResponse: settings.showOwnerResponse ?? config.showOwnerResponse,
    maxChars: settings.maxChars ?? config.maxChars,
  }
}

function renderHero(p: ApiPayload): string {
  const avg = p.business.averageRating ?? 0
  const total = p.business.totalReviewsCount ?? p.distribution.reduce((s, d) => s + d.count, 0)
  const max = Math.max(...p.distribution.map((d) => d.count), 1)
  const writeUrl = p.business.placeId
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(p.business.placeId)}`
    : null
  return `
    <section class="orw-hero">
      <div class="orw-hero-text">
        ${p.business.name ? `<h2 class="orw-hero-name">${escapeHtml(p.business.name)}</h2>` : ''}
        <div class="orw-hero-rating">
          <span class="orw-hero-rating-num">${avg.toFixed(1)}</span>
          <div>
            ${stars(avg)}
            <div class="orw-hero-meta">${total} reviews</div>
          </div>
        </div>
        ${writeUrl ? `<a href="${escapeHtml(writeUrl)}" target="_blank" rel="noopener noreferrer" class="orw-write-btn">&#9733; Write a review</a>` : ''}
      </div>
      <div class="orw-dist" aria-label="Rating distribution">
        ${p.distribution.map((d) => `
          <div class="orw-dist-row">
            <span class="orw-dist-label">${d.rating}${svgStar(true)}</span>
            <span class="orw-dist-bar"><span class="orw-dist-fill" style="width:${Math.round((d.count / max) * 100)}%"></span></span>
            <span class="orw-dist-count">${d.count}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `
}

function truncateText(raw: string, max: number): { display: string; full: string; truncated: boolean } {
  const t = raw.trim()
  if (t.length <= max) return { display: t, full: t, truncated: false }
  return { display: t.slice(0, max).trimEnd() + '…', full: t, truncated: true }
}

function renderReview(r: ReviewItem, config: Pick<WidgetConfig, 'showOwnerResponse' | 'maxChars'>): string {
  const MAX = config.maxChars

  const photos = r.photos.length > 0 ? `
    <div class="orw-photos">
      ${r.photos.map((p) => `
        <button type="button" class="orw-photo" data-orw-photo="${escapeHtml(p.url)}">
          <img src="${escapeHtml(p.url)}" alt="Review photo" loading="lazy" referrerpolicy="no-referrer">
        </button>
      `).join('')}
    </div>
  ` : ''

  const avatar = r.reviewerPhotoUrl
    ? `<img src="${escapeHtml(r.reviewerPhotoUrl)}" alt="${escapeHtml(r.reviewerName ?? 'Reviewer')}" referrerpolicy="no-referrer">`
    : escapeHtml(initials(r.reviewerName))

  const name = r.reviewerProfileUrl
    ? `<a href="${escapeHtml(r.reviewerProfileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.reviewerName ?? 'Anonymous')}</a>`
    : escapeHtml(r.reviewerName ?? 'Anonymous')

  let text = ''
  if (r.text) {
    const { display, full, truncated } = truncateText(r.text, MAX)
    text = `<p class="orw-text">${escapeHtml(display)}</p>`
    if (truncated) text += `<button type="button" class="orw-more" data-orw-expand="${escapeHtml(full)}">Read more</button>`
  }

  let owner = ''
  if (config.showOwnerResponse && r.ownerResponse) {
    const { display, full, truncated } = truncateText(r.ownerResponse, MAX)
    owner = `
      <div class="orw-owner">
        <div class="orw-owner-label">Owner response${r.ownerResponseDate ? ` · ${escapeHtml(r.ownerResponseDate)}` : ''}</div>
        <p class="orw-owner-text">${escapeHtml(display)}</p>
        ${truncated ? `<button type="button" class="orw-more" data-orw-expand="${escapeHtml(full)}">Read more</button>` : ''}
      </div>
    `
  }

  return `
    <article class="orw-card">
      <header class="orw-card-head">
        <span class="orw-avatar">${avatar}</span>
        <div style="min-width:0;flex:1">
          <div class="orw-name" style="display:flex;align-items:center;gap:6px">${name}<span class="orw-google-badge">${GOOGLE_G_SVG}</span></div>
          <div class="orw-meta-row">
            ${stars(r.rating)}
            ${r.dateText ? `<span>${escapeHtml(r.dateText)}</span>` : ''}
            ${r.helpfulCount > 0 ? `<span>· ${r.helpfulCount} helpful</span>` : ''}
          </div>
        </div>
      </header>
      ${text}
      ${photos}
      ${owner}
    </article>
  `
}

function renderFooterCta(config: WidgetConfig, p: ApiPayload): string {
  if (!config.footerCta || !p.business.placeId) return ''
  const url = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(p.business.placeId)}`
  return `<div class="orw-footer-cta"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="orw-write-btn">&#9733; Write a review</a></div>`
}

function renderShell(config: WidgetConfig, payload: ApiPayload): string {
  const cards = payload.reviews.map((r) => renderReview(r, config)).join('')
  const heroHtml = config.showHero ? renderHero(payload) : ''
  const footerHtml = renderFooterCta(config, payload)
  const empty = payload.reviews.length === 0
    ? `<div class="orw-empty">No reviews yet.</div>`
    : ''
  const accent = isHexColor(payload.brand?.accent) ? payload.brand.accent : '#6366F1'
  const brandStyle = ` style="--orw-brand:${escapeHtml(accent)};--orw-brand-soft:${escapeHtml(hexToRgba(accent, config.theme === 'dark' ? 0.22 : 0.12))};"`
  const rootClass = config.equalHeight ? 'orw-root orw-eqh' : 'orw-root'

  if (empty) return `<div class="${rootClass}" data-theme="${config.theme}"${brandStyle}>${heroHtml}${empty}</div>`

  if (config.layout === 'list') {
    return `<div class="${rootClass}" data-theme="${config.theme}"${brandStyle}>${heroHtml}<div class="orw-list">${cards}</div>${footerHtml}</div>`
  }
  if (config.layout === 'carousel') {
    return `<div class="${rootClass}" data-theme="${config.theme}"${brandStyle}>${heroHtml}<div class="orw-carousel-wrap"><div class="orw-carousel-viewport"><div class="orw-carousel-track">${cards}</div></div></div>${footerHtml}</div>`
  }
  return `<div class="${rootClass}" data-theme="${config.theme}"${brandStyle}>${heroHtml}<div class="orw-grid">${cards}</div>${footerHtml}</div>`
}

function wireCarousel(root: HTMLElement): void {
  const viewportEl = root.querySelector<HTMLElement>('.orw-carousel-viewport')
  const trackEl = root.querySelector<HTMLElement>('.orw-carousel-track')
  const wrapEl = root.querySelector<HTMLElement>('.orw-carousel-wrap')
  if (!viewportEl || !trackEl || !wrapEl) return

  const viewport: HTMLElement = viewportEl
  const track: HTMLElement = trackEl
  const wrap: HTMLElement = wrapEl

  const AUTOPLAY_MS = 4000
  const GAP = 16

  // Step = one card width + the track gap, so paging snaps card-to-card.
  const getStep = (): number => {
    const first = track.querySelector<HTMLElement>('.orw-card')
    return first ? first.offsetWidth + GAP : 292
  }

  // If the original cards already fit without overflowing there's nothing to
  // loop — leave the row static (no clones, no arrows, no autoplay).
  if (track.scrollWidth - viewport.clientWidth <= 4) return

  // ── Infinite loop, both directions ────────────────────────────────────────
  // Clone the full set on BOTH sides so the track reads
  //   [before-clones][originals][after-clones]
  // and park the scroll on the middle block. Whenever scroll drifts a full
  // block off-centre we snap it back by exactly one block width. Because every
  // block is an identical copy, the snap is invisible — the user can scroll
  // forever in either direction and never hit a wall.
  const originals = Array.from(track.querySelectorAll<HTMLElement>('.orw-card'))
  const before: HTMLElement[] = []
  originals.forEach(card => {
    const lead = card.cloneNode(true) as HTMLElement
    lead.setAttribute('aria-hidden', 'true')
    before.push(lead)
    const trail = card.cloneNode(true) as HTMLElement
    trail.setAttribute('aria-hidden', 'true')
    track.appendChild(trail)
  })
  before.forEach(node => track.insertBefore(node, originals[0]))

  // The track now holds three identical blocks. One block advance =
  // (scrollWidth + GAP) / 3 (the +GAP collapses the inter-card gaps evenly).
  const blockWidth = (): number => (track.scrollWidth + GAP) / 3
  // Park on the centre of the middle block: a full block of runway each side
  // before a snap is needed, so single-step glides never reach a boundary.
  const recenter = (): void => { viewport.scrollLeft = blockWidth() * 1.5 }
  recenter()

  let loopLock = false
  viewport.addEventListener('scroll', () => {
    if (loopLock) return
    const bw = blockWidth()
    if (bw <= 0) return
    const x = viewport.scrollLeft
    if (x >= bw * 2.5) {
      loopLock = true
      viewport.scrollLeft = x - bw
      loopLock = false
    } else if (x <= bw * 0.5) {
      loopLock = true
      viewport.scrollLeft = x + bw
      loopLock = false
    }
  }, { passive: true })
  // ─────────────────────────────────────────────────────────────────────────

  // Prev / next arrows — both always active now that there's no wall.
  const prev = document.createElement('button')
  prev.type = 'button'
  prev.className = 'orw-carousel-btn orw-carousel-prev'
  prev.setAttribute('aria-label', 'Previous')
  prev.innerHTML = '&#8249;'
  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'orw-carousel-btn orw-carousel-next'
  next.setAttribute('aria-label', 'Next')
  next.innerHTML = '&#8250;'
  wrap.appendChild(prev)
  wrap.appendChild(next)
  prev.addEventListener('click', () => viewport.scrollBy({ left: -getStep(), behavior: 'smooth' }))
  next.addEventListener('click', () => viewport.scrollBy({ left: getStep(), behavior: 'smooth' }))

  // Re-park on resize — card (and therefore block) widths change with it.
  window.addEventListener('resize', recenter)

  // Autoplay — advance one step every 4s. The loop listener handles the wrap.
  let hovered = false
  let timer: ReturnType<typeof setInterval> | null = null
  const advance = (): void => {
    viewport.scrollTo({
      left: viewport.scrollLeft + getStep(),
      behavior: 'smooth',
    })
  }
  const startAuto = (): void => {
    if (!timer && !hovered) timer = setInterval(advance, AUTOPLAY_MS)
  }
  const stopAuto = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  viewport.addEventListener('mouseenter', () => { hovered = true; stopAuto() })
  viewport.addEventListener('mouseleave', () => { hovered = false; startAuto() })
  startAuto()

  // Drag-to-scroll (mouse only — touch uses native momentum scrolling).
  const drag = { active: false, startX: 0, startScroll: 0 }
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return
    drag.active = true
    drag.startX = e.clientX
    drag.startScroll = viewport.scrollLeft
    viewport.setPointerCapture(e.pointerId)
    viewport.classList.add('orw-dragging')
    stopAuto()
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!drag.active || e.pointerType !== 'mouse') return
    e.preventDefault()
    viewport.scrollLeft = drag.startScroll + (drag.startX - e.clientX)
  })
  const endDrag = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || !drag.active) return
    drag.active = false
    viewport.classList.remove('orw-dragging')
    if (!hovered) startAuto()
  }
  viewport.addEventListener('pointerup', endDrag)
  viewport.addEventListener('pointercancel', endDrag)
}

function wireInteractions(root: HTMLElement): void {
  // Event delegation for "Read more" — works for original cards AND cloned carousel cards.
  // data-orw-expand holds the full text; clicking replaces the preceding <p>'s textContent.
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-orw-expand]')
    if (!btn) return
    const prev = btn.previousElementSibling as HTMLElement | null
    if (!prev) return
    prev.textContent = btn.dataset.orwExpand ?? ''
    btn.remove()
  })

  // Lightbox
  const lb = document.createElement('div')
  lb.className = 'orw-lightbox'
  lb.innerHTML = `<button type="button" class="orw-lightbox-close" aria-label="Close">×</button><img alt="">`
  document.body.appendChild(lb)
  const lbImg = lb.querySelector('img') as HTMLImageElement
  const close = () => lb.classList.remove('open')
  lb.querySelector('.orw-lightbox-close')!.addEventListener('click', close)
  lb.addEventListener('click', (e) => { if (e.target === lb) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  root.querySelectorAll<HTMLButtonElement>('[data-orw-photo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      lbImg.src = btn.dataset.orwPhoto!
      lb.classList.add('open')
    })
  })

  wireCarousel(root)
}

// When rendered inside an iframe, report content height to the parent so the
// host page can resize the <iframe> to fit (no inner scrollbars / dead space).
function setupAutoHeight(token: string): void {
  if (window.parent === window) return // not framed
  const post = () => {
    const h = Math.ceil(document.documentElement.scrollHeight)
    try {
      window.parent.postMessage({ type: 'orw-resize', token, height: h }, '*')
    } catch {
      /* cross-origin parent | ignore */
    }
  }
  post()
  window.addEventListener('load', post)
  window.addEventListener('resize', post)
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(post).observe(document.body)
  }
  document.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', post, { once: true })
  })
}

async function main() {
  const config = getConfig()
  if (!config) {
    console.warn('[operator-reviews] no config found | provide ?token= query param or a [data-token] element.')
    return
  }

  // Inject CSS once
  if (!document.getElementById('orw-style')) {
    const style = document.createElement('style')
    style.id = 'orw-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  const params = new URLSearchParams({
    settings: '1',
    sort: config.sort,
  })
  const url = `${config.apiBase}/api/reviews/${encodeURIComponent(config.token)}?${params.toString()}`

  let payload: ApiPayload
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = (await res.json()) as ApiPayload
  } catch (err) {
    console.error('[operator-reviews] failed to load reviews', err)
    return
  }

  const effectiveConfig = withSavedSettings(config, payload.settings)
  const html = renderShell(effectiveConfig, payload)

  // Mount: iframe/standalone uses document.body; embed uses [data-token] host
  const sp = new URLSearchParams(window.location.search)
  const host = sp.has('token')
    ? document.body
    : document.querySelector<HTMLElement>('[data-operator-reviews][data-token], #operator-reviews[data-token]')!

  host.innerHTML = html
  wireInteractions(host)

  // Iframe embeds: auto-resize the frame to content height.
  if (sp.has('token')) setupAutoHeight(effectiveConfig.token)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  void main()
}
