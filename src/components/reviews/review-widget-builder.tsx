'use client'

import type { ComponentType, ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  Grid3x3,
  List,
  Loader2,
  MonitorSmartphone,
  Save,
  Share2,
  SlidersHorizontal,
  Star,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { SavedWidgetSettings } from '@/app/(dashboard)/reviews/actions'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { StarRating } from './star-rating'

type Layout = 'grid' | 'list' | 'carousel'
type Theme = 'light' | 'dark'
type EmbedMode = 'iframe' | 'script'
type SortOrder = 'quality' | 'recent'

export type ReviewWidgetPreviewReview = {
  id: string
  reviewerName: string | null
  reviewerPhotoUrl: string | null
  reviewerProfileUrl: string | null
  rating: number
  text: string | null
  dateText: string | null
  isLocalGuide: boolean
  helpfulCount: number
  ownerResponse: string | null
  ownerResponseDate: string | null
  photos: { url: string }[]
}

interface ReviewWidgetBuilderProps {
  baseUrl: string
  widgetToken: string
  profileId?: string
  embedded?: boolean
  brandAccent: string
  business: {
    name: string | null
    address: string | null
    placeId?: string | null
    averageRating: number | null
    totalReviewsCount: number | null
  }
  distribution: { rating: number; count: number }[]
  reviews: ReviewWidgetPreviewReview[]
  savedSettings?: SavedWidgetSettings
  onSave?: (settings: SavedWidgetSettings) => Promise<void>
  /** Optional element rendered in the header (e.g. a settings button). */
  settingsSlot?: ReactNode
}

const LAYOUTS: Array<{
  id: Layout
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'carousel', label: 'Carousel', icon: SlidersHorizontal },
  { id: 'grid', label: 'Grid', icon: Grid3x3 },
  { id: 'list', label: 'List', icon: List },
]

function qualityScore(r: ReviewWidgetPreviewReview): number {
  let s = 0
  if (r.photos.length > 0) s += 10
  if (r.ownerResponse) s += 5
  s += Math.min((r.text?.length ?? 0) / 100, 5)
  return s
}

function initials(name: string | null): string {
  if (!name) return 'R'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-label="Google review" role="img" className="shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function hexBlendSolid(hex: string, alpha: number, baseR: number, baseG: number, baseB: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 0xff) * alpha + baseR * (1 - alpha))
  const g = Math.round(((n >> 8) & 0xff) * alpha + baseG * (1 - alpha))
  const b = Math.round((n & 0xff) * alpha + baseB * (1 - alpha))
  return `rgb(${r}, ${g}, ${b})`
}

function iframeHeight(layout: Layout, showHero: boolean): number {
  if (layout === 'carousel') return showHero ? 500 : 360
  if (layout === 'list') return showHero ? 720 : 560
  return showHero ? 760 : 620
}

function buildWidgetUrl({
  baseUrl,
  widgetToken,
}: {
  baseUrl: string
  widgetToken: string
}) {
  return `${baseUrl}/widget/reviews/${widgetToken}`
}

function PreviewCard({
  review,
  theme,
  brandAccent,
  compact = false,
  fill = false,
  maxChars = 220,
  showOwnerResponse = true,
}: {
  review: ReviewWidgetPreviewReview
  theme: Theme
  brandAccent: string
  compact?: boolean
  fill?: boolean
  maxChars?: number
  showOwnerResponse?: boolean
}) {
  const [textExpanded, setTextExpanded] = useState(false)
  const [responseExpanded, setResponseExpanded] = useState(false)
  const brandSoft = hexToRgba(brandAccent, theme === 'dark' ? 0.22 : 0.12)
  const rawText = review.text ?? ''
  const textTruncable = rawText.length > maxChars
  const displayText = textTruncable && !textExpanded
    ? `${rawText.slice(0, maxChars).trimEnd()}…`
    : rawText
  const rawResponse = review.ownerResponse ?? ''
  const responseTruncable = rawResponse.length > maxChars
  const displayResponse = responseTruncable && !responseExpanded
    ? `${rawResponse.slice(0, maxChars).trimEnd()}…`
    : rawResponse
  return (
    <article
      className={cn(
        'min-w-0 rounded-[14px] border p-4 shadow-sm',
        fill && 'h-full',
        theme === 'dark'
          ? 'border-white/10 bg-zinc-900 text-zinc-50 shadow-black/30'
          : 'border-zinc-200 bg-white text-zinc-950 shadow-zinc-200/70',
      )}
    >
      <header className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={review.reviewerPhotoUrl ?? undefined} alt={review.reviewerName ?? 'Reviewer'} />
          <AvatarFallback
            className="text-xs font-semibold"
            style={{ backgroundColor: brandSoft, color: brandAccent }}
          >
            {initials(review.reviewerName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[13px] font-semibold">
              {review.reviewerName ?? 'Anonymous'}
            </p>
            <span className="ml-auto"><GoogleIcon /></span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StarRating rating={review.rating} size="sm" />
            {review.dateText ? (
              <span className={cn('text-[11px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                {review.dateText}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mt-3">
        <p
          className={cn(
            'whitespace-pre-line text-[13px] leading-relaxed',
            theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700',
          )}
        >
          {displayText || 'No written review.'}
        </p>
        {textTruncable && (
          <button
            type="button"
            onClick={() => setTextExpanded((v) => !v)}
            className="mt-1 text-[11px] font-medium hover:underline"
            style={{ color: brandAccent }}
          >
            {textExpanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {review.photos.length > 0 ? (
        <div className="mt-3 flex gap-1.5 overflow-hidden">
          {review.photos.slice(0, 4).map((photo, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${photo.url}-${index}`}
              src={photo.url}
              alt=""
              className="h-14 w-14 rounded-[8px] object-cover"
              loading="lazy"
            />
          ))}
        </div>
      ) : null}

      {showOwnerResponse && review.ownerResponse ? (
        <div
          className={cn(
            'mt-3 rounded-[10px] border-l-2 px-3 py-2',
            theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700',
          )}
          style={{ backgroundColor: brandSoft, borderLeftColor: brandAccent }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: brandAccent }}>
            Owner response
          </p>
          <p className="mt-1 text-[12px] leading-relaxed">{displayResponse}</p>
          {responseTruncable && (
            <button
              type="button"
              onClick={() => setResponseExpanded((v) => !v)}
              className="mt-1 text-[11px] font-medium hover:underline"
              style={{ color: brandAccent }}
            >
              {responseExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      ) : null}
    </article>
  )
}

function PreviewCarousel({
  reviews,
  theme,
  brandAccent,
  equalHeight,
  maxChars,
  showOwnerResponse,
}: {
  reviews: ReviewWidgetPreviewReview[]
  theme: Theme
  brandAccent: string
  equalHeight: boolean
  maxChars: number
  showOwnerResponse: boolean
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0 })

  const getStep = useCallback((): number => {
    const first = viewportRef.current?.querySelector<HTMLElement>('[data-card]')
    return first ? first.offsetWidth + 12 : 292
  }, [])

  const advance = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return
    vp.scrollTo({ left: vp.scrollLeft + getStep(), behavior: 'smooth' })
  }, [getStep])

  const scrollDir = useCallback((dir: 1 | -1) => {
    viewportRef.current?.scrollBy({ left: dir * getStep(), behavior: 'smooth' })
  }, [getStep])

  // Infinite loop in BOTH directions: the track renders three identical blocks
  // ([before][originals][after]); we park on the middle block and snap back by
  // one block width whenever scroll drifts a full block off-centre. The copies
  // are identical, so the snap is invisible and neither end ever hits a wall.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const blockWidth = () => (vp.scrollWidth + 12) / 3 // 12 = gap-3
    vp.scrollLeft = blockWidth() * 1.5 // centre of the middle block
    let lock = false
    const onScroll = () => {
      if (lock) return
      const bw = blockWidth()
      if (bw <= 0) return
      const x = vp.scrollLeft
      if (x >= bw * 2.5) {
        lock = true
        vp.scrollLeft = x - bw
        lock = false
      } else if (x <= bw * 0.5) {
        lock = true
        vp.scrollLeft = x + bw
        lock = false
      }
    }
    vp.addEventListener('scroll', onScroll, { passive: true })
    return () => vp.removeEventListener('scroll', onScroll)
  }, [reviews.length])

  useEffect(() => {
    if (hovered) return
    timerRef.current = setInterval(advance, 4000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [hovered, advance])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return
    dragRef.current = { active: true, startX: e.clientX, startScroll: viewportRef.current?.scrollLeft ?? 0 }
    viewportRef.current?.setPointerCapture(e.pointerId)
    setDragging(true)
    if (timerRef.current) clearInterval(timerRef.current)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.active || e.pointerType !== 'mouse' || !viewportRef.current) return
    e.preventDefault()
    viewportRef.current.scrollLeft = dragRef.current.startScroll + (dragRef.current.startX - e.clientX)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || !dragRef.current.active) return
    dragRef.current.active = false
    setDragging(false)
    if (!hovered) timerRef.current = setInterval(advance, 4000)
  }

  const btnClass = cn(
    'absolute top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border text-lg shadow-sm transition hover:scale-105',
    theme === 'dark'
      ? 'border-white/10 bg-zinc-800 text-zinc-200'
      : 'border-zinc-200 bg-white text-zinc-700',
  )

  return (
    <div className="relative">
      <button type="button" onClick={() => scrollDir(-1)} className={cn(btnClass, 'left-1.5')} aria-label="Previous">‹</button>
      <button type="button" onClick={() => scrollDir(1)} className={cn(btnClass, 'right-1.5')} aria-label="Next">›</button>
      {/* pb-2 (8px) is enough HERE because PreviewCard uses `shadow-sm` (~3px
          reach). The live widget's card uses --orw-shadow (0 10px 30px, 40px
          reach) and therefore carries 56px of padding with a -48px pull-back —
          see .orw-carousel-viewport in src/reviews-widget/index.ts. The two are
          in lock-step on the visible card->CTA gap (32px), NOT on this number.
          If you change the shadow on either side, redo that arithmetic. */}
      <div
        ref={viewportRef}
        className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden cursor-grab active:cursor-grabbing select-none"
        style={{
          scrollSnapType: dragging ? 'none' : 'x mandatory',
          scrollBehavior: dragging ? 'auto' : undefined,
          WebkitOverflowScrolling: 'touch' as never,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="grid auto-cols-[minmax(280px,70%)] grid-flow-col items-stretch gap-3">
          {[...reviews, ...reviews, ...reviews].map((review, i) => (
            <div key={`${review.id}-${i}`} data-card aria-hidden={(i < reviews.length || i >= reviews.length * 2) || undefined} className={cn(equalHeight && 'h-full')} style={{ scrollSnapAlign: 'start' }}>
              <PreviewCard review={review} theme={theme} brandAccent={brandAccent} compact fill={equalHeight} maxChars={maxChars} showOwnerResponse={showOwnerResponse} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ReviewWidgetBuilder({
  baseUrl,
  widgetToken,
  embedded = false,
  brandAccent,
  business,
  distribution,
  reviews,
  savedSettings,
  onSave,
  settingsSlot,
}: ReviewWidgetBuilderProps) {
  const [layout, setLayout] = useState<Layout>((savedSettings?.layout as Layout) ?? 'carousel')
  const [theme, setTheme] = useState<Theme>((savedSettings?.theme as Theme) ?? 'light')
  const [minRating, setMinRating] = useState(savedSettings?.minRating ?? '4')
  const [limit, setLimit] = useState(savedSettings?.limit ?? '12')
  const [sort, setSort] = useState<SortOrder>((savedSettings?.sort as SortOrder) ?? 'quality')
  const [showHero, setShowHero] = useState(savedSettings?.showHero ?? true)
  const [equalHeight, setEqualHeight] = useState(savedSettings?.equalHeight ?? true)
  const [footerCta, setFooterCta] = useState(savedSettings?.footerCta ?? false)
  const [maxChars, setMaxChars] = useState(savedSettings?.maxChars ?? '220')
  const [showOwnerResponse, setShowOwnerResponse] = useState(savedSettings?.showOwnerResponse ?? true)
  const [embedMode, setEmbedMode] = useState<EmbedMode>((savedSettings?.embedMode as EmbedMode) ?? 'script')
  const [embedOpen, setEmbedOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastSaved, setLastSaved] = useState({
    layout: (savedSettings?.layout as Layout) ?? 'carousel',
    theme: (savedSettings?.theme as Theme) ?? 'light',
    minRating: savedSettings?.minRating ?? '4',
    limit: savedSettings?.limit ?? '12',
    sort: (savedSettings?.sort as SortOrder) ?? 'quality',
    showHero: savedSettings?.showHero ?? true,
    equalHeight: savedSettings?.equalHeight ?? true,
    footerCta: savedSettings?.footerCta ?? false,
    maxChars: savedSettings?.maxChars ?? '220',
    showOwnerResponse: savedSettings?.showOwnerResponse ?? true,
    embedMode: (savedSettings?.embedMode as EmbedMode) ?? 'script',
  })
  const isDirty = onSave != null && (
    layout !== lastSaved.layout ||
    theme !== lastSaved.theme ||
    minRating !== lastSaved.minRating ||
    limit !== lastSaved.limit ||
    sort !== lastSaved.sort ||
    showHero !== lastSaved.showHero ||
    equalHeight !== lastSaved.equalHeight ||
    footerCta !== lastSaved.footerCta ||
    maxChars !== lastSaved.maxChars ||
    showOwnerResponse !== lastSaved.showOwnerResponse ||
    embedMode !== lastSaved.embedMode
  )
  const accent = isHexColor(brandAccent) ? brandAccent : '#6366F1'
  const heroSolidStart = theme === 'dark'
    ? hexBlendSolid(accent, 0.22, 24, 24, 27)
    : hexBlendSolid(accent, 0.12, 255, 255, 255)
  const heroSolidEnd = theme === 'dark' ? '#18181b' : '#ffffff'

  const visibleReviews = useMemo(() => {
    const min = Number.parseInt(minRating, 10)
    const filtered = reviews.filter((review) => review.rating >= min)
    const sorted = sort === 'quality'
      ? [...filtered].sort((a, b) => qualityScore(b) - qualityScore(a))
      : filtered
    return limit === 'all' ? sorted : sorted.slice(0, Number.parseInt(limit, 10))
  }, [limit, minRating, reviews, sort])

  const widgetUrl = buildWidgetUrl({
    baseUrl,
    widgetToken,
  })
  const height = iframeHeight(layout, showHero)
  const title = `${business.name ?? 'Google'} reviews`
  const safeTitle = escapeAttribute(title)
  const embedOrigin = (() => {
    try {
      return new URL(baseUrl).origin
    } catch {
      return ''
    }
  })()
  const originCheck = embedOrigin ? `if(e.origin!==${JSON.stringify(embedOrigin)})return;` : ''

  const iframeSnippet = `<iframe
  src="${widgetUrl}"
  width="100%"
  height="${height}"
  frameborder="0"
  style="border:0;border-radius:16px;overflow:hidden;width:100%;"
  loading="lazy"
  title="${safeTitle}"
  data-orw-frame="${widgetToken}"></iframe>
<script>
(function(){window.addEventListener("message",function(e){${originCheck}var d=e.data;if(!d||d.type!=="orw-resize")return;var f=document.querySelector('iframe[data-orw-frame="'+d.token+'"]');if(f&&d.height)f.style.height=d.height+"px";});})();
</script>`

  const scriptSnippet = `<div
  data-operator-reviews
  data-token="${widgetToken}">
</div>
<script src="${baseUrl}/reviews-widget.js" defer></script>`

  const snippet = embedMode === 'iframe' ? iframeSnippet : scriptSnippet
  const maxDistribution = Math.max(...distribution.map((row) => row.count), 1)

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Fallback for browsers/contexts where clipboard API is unavailable
      try {
        const ta = document.createElement('textarea')
        ta.value = snippet
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        } else {
          toast.error('Failed to copy — please select the code manually.')
        }
      } catch {
        toast.error('Failed to copy — please select the code manually.')
      }
    }
  }

  async function handleSave() {
    if (!onSave || saveState === 'saving') return
    setSaveState('saving')
    try {
      await onSave({ layout, theme, minRating, limit, sort, showHero, equalHeight, footerCta, embedMode, maxChars, showOwnerResponse })
      setLastSaved({ layout, theme, minRating, limit, sort, showHero, equalHeight, footerCta, maxChars, showOwnerResponse, embedMode })
      setSaveState('saved')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('idle')
    }
  }

  return (
    <>
    <section
      className={cn(
        'overflow-hidden',
        embedded ? 'rounded-none' : 'rounded-[8px] border border-border bg-bg-secondary',
      )}
    >
      <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
        <aside
          className={cn(
            'border-b border-border-subtle p-5 lg:border-b-0 lg:border-r',
            embedded && 'p-0 pb-5 lg:pb-0 lg:pr-5',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-bg-tertiary text-accent">
                <MonitorSmartphone className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-[15px] font-medium text-text-primary">Website widget</h2>
                <p className="text-[12px] text-text-tertiary">Preview and embed code</p>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Layout
              </Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {LAYOUTS.map((item) => {
                  const Icon = item.icon
                  const active = item.id === layout
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLayout(item.id)}
                      className={cn(
                        'flex h-16 flex-col items-center justify-center gap-1 rounded-[8px] border text-[11px] font-medium transition-colors',
                        active
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-border bg-bg-tertiary/50 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  Min rating
                </Label>
                <Select value={minRating} onValueChange={setMinRating}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1+ stars</SelectItem>
                    <SelectItem value="2">2+ stars</SelectItem>
                    <SelectItem value="3">3+ stars</SelectItem>
                    <SelectItem value="4">4+ stars</SelectItem>
                    <SelectItem value="5">5 stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  Limit
                </Label>
                <Select value={limit} onValueChange={setLimit}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 reviews</SelectItem>
                    <SelectItem value="9">9 reviews</SelectItem>
                    <SelectItem value="12">12 reviews</SelectItem>
                    <SelectItem value="18">18 reviews</SelectItem>
                    <SelectItem value="all">All reviews</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Sort reviews
              </Label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortOrder)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quality">Most relevant (photo · response · length)</SelectItem>
                  <SelectItem value="recent">Most recent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-[8px] border border-border bg-bg-tertiary/50 px-3 py-2">
              <Label htmlFor="reviews-widget-hero" className="text-[12px] font-medium text-text-secondary">
                Summary header
              </Label>
              <Switch id="reviews-widget-hero" checked={showHero} onCheckedChange={setShowHero} />
            </div>

            <div className="flex items-center justify-between rounded-[8px] border border-border bg-bg-tertiary/50 px-3 py-2">
              <Label htmlFor="reviews-widget-eqh" className="text-[12px] font-medium text-text-secondary">
                Equal card height
              </Label>
              <Switch id="reviews-widget-eqh" checked={equalHeight} onCheckedChange={setEqualHeight} />
            </div>

            <div className="flex items-center justify-between rounded-[8px] border border-border bg-bg-tertiary/50 px-3 py-2">
              <Label htmlFor="reviews-widget-cta" className="text-[12px] font-medium text-text-secondary">
                &ldquo;Write a review&rdquo; below cards
              </Label>
              <Switch id="reviews-widget-cta" checked={footerCta} onCheckedChange={setFooterCta} />
            </div>

            <div className="flex items-center justify-between rounded-[8px] border border-border bg-bg-tertiary/50 px-3 py-2">
              <Label htmlFor="reviews-widget-owner" className="text-[12px] font-medium text-text-secondary">
                Owner responses
              </Label>
              <Switch id="reviews-widget-owner" checked={showOwnerResponse} onCheckedChange={setShowOwnerResponse} />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Max review length
              </Label>
              <Select value={maxChars} onValueChange={setMaxChars}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">100 chars</SelectItem>
                  <SelectItem value="150">150 chars</SelectItem>
                  <SelectItem value="220">220 chars</SelectItem>
                  <SelectItem value="350">350 chars</SelectItem>
                  <SelectItem value="500">500 chars</SelectItem>
                  <SelectItem value="2000">No limit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Theme
              </Label>
              <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-[8px] border border-border bg-bg-tertiary/50 p-1">
                {(['light', 'dark'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTheme(item)}
                    className={cn(
                      'rounded-[6px] px-3 py-1.5 text-[12px] font-medium capitalize transition-colors',
                      theme === item ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </aside>

        <div className={cn('min-w-0 p-5', embedded && 'p-0 pt-5 lg:pl-5 lg:pt-0')}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-text-tertiary" />
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Live preview
              </p>
            </div>
            <div className="flex items-center gap-2">
              {settingsSlot && <Fragment key="settings-slot">{settingsSlot}</Fragment>}
              <div className="relative">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setEmbedOpen((v) => !v)}
                  className="h-8 gap-1.5 text-[12px]"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </Button>

                {embedOpen ? (
                  <>
                    <button
                      type="button"
                      aria-label="Close share panel"
                      className="fixed inset-0 z-20 cursor-default"
                      onClick={() => setEmbedOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-30 mt-2 w-[min(460px,78vw)] overflow-hidden rounded-[10px] border border-border bg-bg-primary shadow-xl">
                      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <div className="flex overflow-hidden rounded-[7px] border border-border bg-bg-tertiary/50 p-0.5">
                          {(['iframe', 'script'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setEmbedMode(mode)}
                              className={cn(
                                'rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors',
                                embedMode === mode
                                  ? 'bg-bg-primary text-text-primary shadow-sm'
                                  : 'text-text-tertiary hover:text-text-primary',
                              )}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={copySnippet}
                          className="h-7 gap-1 text-[11.5px]"
                        >
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                      <pre className="max-h-72 overflow-auto bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-100">
                        <code>{snippet}</code>
                      </pre>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div
            className={cn(
              'max-h-[760px] overflow-auto rounded-[16px] border p-0',
              theme === 'dark'
                ? 'border-zinc-800'
                : 'border-zinc-200',
            )}
            style={{
              backgroundColor: theme === 'dark' ? '#18181b' : '#fafaf7',
              backgroundImage:
                theme === 'dark'
                  ? 'linear-gradient(45deg, rgba(255,255,255,0.035) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.035) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.035) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.035) 75%)'
                  : 'linear-gradient(45deg, rgba(24,24,27,0.035) 25%, transparent 25%), linear-gradient(-45deg, rgba(24,24,27,0.035) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(24,24,27,0.035) 75%), linear-gradient(-45deg, transparent 75%, rgba(24,24,27,0.035) 75%)',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              backgroundSize: '16px 16px',
            }}
          >
            {showHero ? (
              <section
                className={cn(
                  'mb-4 select-none rounded-[16px] border p-5',
                  theme === 'dark'
                    ? 'border-white/10 text-zinc-50'
                    : 'border-zinc-200 text-zinc-950',
                )}
                style={{
                  background: `linear-gradient(135deg, ${heroSolidStart}, ${heroSolidEnd} 80%)`,
                }}
              >
                <div className="grid gap-5 md:grid-cols-[1fr_220px] md:items-center">
                  <div>
                    <p className="text-[14px] font-semibold">{business.name ?? 'Google reviews'}</p>
                    {business.address ? (
                      <p className={cn('mt-0.5 text-[12px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                        {business.address}
                      </p>
                    ) : null}
                    <div className="mt-4 flex items-baseline gap-3">
                      <span className="text-5xl font-semibold leading-none tracking-tight tabular-nums">
                        {(business.averageRating ?? 0).toFixed(1)}
                      </span>
                      <div>
                        <StarRating rating={business.averageRating ?? 0} size="md" />
                        <p className={cn('mt-1 text-[12px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                          {business.totalReviewsCount ?? reviews.length} reviews
                        </p>
                      </div>
                    </div>
                    {business.placeId ? (
                      <a
                        href={`https://search.google.com/local/writereview?placeid=${encodeURIComponent(business.placeId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-85"
                        style={{ backgroundColor: accent }}
                      >
                        ★ Write a review
                      </a>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    {distribution.map((row) => (
                      <div key={row.rating} className="flex items-center gap-2">
                        <span className={cn('flex w-8 items-center gap-1 text-[11px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                          {row.rating}
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        </span>
                        <div className={cn('h-2 flex-1 overflow-hidden rounded-full', theme === 'dark' ? 'bg-white/10' : 'bg-zinc-200')}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              backgroundColor: accent,
                              width: `${Math.round((row.count / maxDistribution) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className={cn('w-7 text-right text-[11px] tabular-nums', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {visibleReviews.length === 0 ? (
              <div
                className={cn(
                  'rounded-[14px] border border-dashed p-10 text-center text-sm',
                  theme === 'dark' ? 'border-white/10 text-zinc-400' : 'border-zinc-300 text-zinc-500',
                )}
              >
                No reviews match this widget setup.
              </div>
            ) : layout === 'list' ? (
              <div className="space-y-3">
                {visibleReviews.map((review) => (
                  <PreviewCard key={review.id} review={review} theme={theme} brandAccent={accent} maxChars={Number(maxChars)} showOwnerResponse={showOwnerResponse} />
                ))}
              </div>
            ) : layout === 'carousel' ? (
              <PreviewCarousel reviews={visibleReviews} theme={theme} brandAccent={accent} equalHeight={equalHeight} maxChars={Number(maxChars)} showOwnerResponse={showOwnerResponse} />
            ) : (
              <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleReviews.map((review) => (
                  <PreviewCard key={review.id} review={review} theme={theme} brandAccent={accent} compact fill={equalHeight} maxChars={Number(maxChars)} showOwnerResponse={showOwnerResponse} />
                ))}
              </div>
            )}

            {footerCta && business.placeId && visibleReviews.length > 0 ? (
              <div className="mt-6 flex justify-center">
                <a
                  href={`https://search.google.com/local/writereview?placeid=${encodeURIComponent(business.placeId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-85"
                  style={{ backgroundColor: accent }}
                >
                  ★ Write a review
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>

    {onSave ? (
      <div
        className={cn(
          'fixed bottom-[92px] right-5 z-40 transition-all duration-200 ease-out',
          isDirty
            ? 'translate-y-0 opacity-100 pointer-events-auto'
            : 'pointer-events-none translate-y-2 opacity-0',
        )}
        role="region"
        aria-label="Unsaved changes"
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-secondary/95 px-3 py-2 shadow-xl shadow-black/20 backdrop-blur">
          <span className="mr-1 text-[12.5px] font-medium text-text-secondary">
            Unsaved changes
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="gap-1.5"
          >
            {saveState === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saveState === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    ) : null}
  </>
  )
}
