import type { BookingDiscovery } from './booking-discovery'

// Types for the Website Analyzer service (Active Prospect System).
// These match the website_analyses table columns + internal extraction shapes.

export interface BrandColor {
  hex: string
  role: 'background' | 'text' | 'accent' | 'unknown'
}

/** Raw output from the Playwright extractor. */
export interface RawExtraction {
  resolvedUrl: string
  pageTitle: string
  loadMs: number
  isMobileResponsive: boolean
  hasClearlyCTA: boolean
  hasContactInfo: boolean
  brandColors: BrandColor[]
  logoUrl: string | null
  headings: string[]      // h1–h3 text (first 10)
  navItems: string[]      // nav/header link text
  heroText: string[]      // hero section paragraphs/taglines
  booking: BookingDiscovery
  desktopScreenshot: Buffer
  mobileScreenshot: Buffer
  rawCssVars: Record<string, string>
}

/** Final analysis result stored in the DB. */
export interface AnalysisResult {
  url: string
  leadScore: number
  brandColors: BrandColor[]
  logoUrl: string | null
  services: string[]      // derived from headings + nav
  painPoints: string[]    // derived from hero text / taglines
  screenshotDesktopUrl: string | null
  screenshotMobileUrl: string | null
  rawEvidence: Record<string, unknown>
  outreachInsights: Record<string, string>
  booking: BookingDiscovery
}

/** Status shape returned by GET /api/v1/accounts/:id/analyze */
export interface AnalysisStatus {
  id: string
  accountId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dead'
  leadScore: number | null
  brandColors: BrandColor[]
  logoUrl: string | null
  services: string[]
  painPoints: string[]
  outreachInsights: Record<string, string>
  screenshotDesktopUrl: string | null
  screenshotMobileUrl: string | null
  analyzedAt: string | null
  errorMessage: string | null
}
