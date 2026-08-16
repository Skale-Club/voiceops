export type BookingLinkSource = 'link' | 'iframe' | 'form'
export type BookingMode = 'third_party' | 'on_site' | 'external_unknown' | 'none'

export interface BookingCandidate {
  url: string
  label?: string
  source: BookingLinkSource
}

export interface BookingLink {
  url: string
  label: string | null
  source: BookingLinkSource
  provider: string
  mode: Exclude<BookingMode, 'none'>
}

export interface BookingDiscovery {
  detected: boolean
  mode: BookingMode
  primaryProvider: string | null
  primaryUrl: string | null
  platforms: string[]
  links: BookingLink[]
}

type ProviderDefinition = { domains: string[]; name: string }

const BOOKING_PROVIDERS: ProviderDefinition[] = [
  { domains: ['booksy.com'], name: 'Booksy' },
  { domains: ['thecut.co'], name: 'TheCut' },
  { domains: ['getsquire.com'], name: 'Squire' },
  { domains: ['glossgenius.com'], name: 'GlossGenius' },
  { domains: ['vagaro.com'], name: 'Vagaro' },
  { domains: ['fresha.com'], name: 'Fresha' },
  { domains: ['styleseat.com'], name: 'StyleSeat' },
  { domains: ['schedulicity.com'], name: 'Schedulicity' },
  { domains: ['setmore.com'], name: 'Setmore' },
  { domains: ['acuityscheduling.com'], name: 'Acuity Scheduling' },
  { domains: ['mindbodyonline.com', 'mindbody.io'], name: 'Mindbody' },
  { domains: ['simplybook.me'], name: 'SimplyBook.me' },
  { domains: ['appointy.com'], name: 'Appointy' },
  { domains: ['mytime.com'], name: 'MyTime' },
  { domains: ['phorest.com'], name: 'Phorest' },
  { domains: ['joinblvd.com', 'boulevard.io'], name: 'Boulevard' },
  { domains: ['meevo.com'], name: 'Meevo' },
  { domains: ['zenoti.com'], name: 'Zenoti' },
  { domains: ['salonized.com'], name: 'Salonized' },
  { domains: ['gettimely.com'], name: 'Timely' },
  { domains: ['square.site', 'squareup.com'], name: 'Square Appointments' },
  { domains: ['calendly.com'], name: 'Calendly' },
  { domains: ['cal.com'], name: 'Cal.com' },
  { domains: ['resy.com'], name: 'Resy' },
  { domains: ['opentable.com'], name: 'OpenTable' },
]

const BOOKING_INTENT = /\b(book(?:ing)?|appointment|schedule|reserve|reservation|agendar|agendamento|marcar|marca[cç][aã]o|reservar|cita|reservar cita)\b/i
const BOOKING_PATH = /\/(book(?:ing)?|appointments?|schedule|reserve|reservation|agendar|agendamento|marcar)(?:[/?#-]|$)/i

function normalizedUrl(raw: string, baseUrl: string): URL | null {
  try {
    const parsed = new URL(raw, baseUrl)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function providerForHost(host: string): string | null {
  return BOOKING_PROVIDERS.find(({ domains }) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  )?.name ?? null
}

function sameSite(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

/** Turn raw anchors/iframes/forms into factual, deduplicated booking evidence. */
export function discoverBooking(pageUrl: string, candidates: BookingCandidate[]): BookingDiscovery {
  const page = normalizedUrl(pageUrl, pageUrl)
  if (!page) return { detected: false, mode: 'none', primaryProvider: null, primaryUrl: null, platforms: [], links: [] }
  const pageHost = normalizedHost(page)
  const seen = new Set<string>()
  const links: BookingLink[] = []

  for (const candidate of candidates) {
    const parsed = normalizedUrl(candidate.url, pageUrl)
    if (!parsed) continue
    const url = parsed.href
    if (seen.has(url)) continue

    const host = normalizedHost(parsed)
    const knownProvider = providerForHost(host)
    const label = candidate.label?.replace(/\s+/g, ' ').trim() || null
    const hasIntent = BOOKING_INTENT.test(label ?? '') || BOOKING_PATH.test(`${parsed.pathname}${parsed.search}${parsed.hash}`)
    if (!knownProvider && !hasIntent) continue

    const isOwnSite = sameSite(pageHost, host)
    const mode: BookingLink['mode'] = knownProvider
      ? 'third_party'
      : isOwnSite
        ? 'on_site'
        : 'external_unknown'
    links.push({
      url,
      label,
      source: candidate.source,
      provider: knownProvider ?? (isOwnSite ? 'Website booking' : host),
      mode,
    })
    seen.add(url)
    if (links.length >= 10) break
  }

  links.sort((a, b) => {
    const rank = (mode: BookingLink['mode']) => mode === 'third_party' ? 0 : mode === 'external_unknown' ? 1 : 2
    return rank(a.mode) - rank(b.mode)
  })
  const primary = links[0] ?? null
  return {
    detected: links.length > 0,
    mode: primary?.mode ?? 'none',
    primaryProvider: primary?.provider ?? null,
    primaryUrl: primary?.url ?? null,
    platforms: [...new Set(links.map((link) => link.provider))],
    links,
  }
}
