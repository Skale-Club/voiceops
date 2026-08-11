// src/lib/widget/position.ts
// Pure, dependency-free placement rules for the embeddable chat widget.
//
// Like url-rules.ts, this module is imported by BOTH the browser widget bundle
// (src/widget/index.ts → public/widget.js) and the Node API routes / server
// actions. It MUST stay import-free so it bundles cleanly into the browser IIFE.
//
// A placement is one of six screen anchors, expressed as `<vertical>-<horizontal>`:
//
//   top-left      top-right
//   middle-left   middle-right
//   bottom-left   bottom-right      ← bottom-right is the default
//
// Spacing is the gap between the bubble and the two screen edges it hugs.
// `offsetY` is meaningless for the `middle-*` anchors (the bubble is centered on
// the viewport), so callers should disable that control when isVerticallyCentered().

export type WidgetPosition =
  | 'top-left'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-right'

export const WIDGET_POSITIONS: readonly WidgetPosition[] = [
  'top-left',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-right',
]

export const WIDGET_POSITION_DEFAULT: WidgetPosition = 'bottom-right'

/** Spacing bounds, in px. Shared by the DB check, the API and the settings UI. */
export const WIDGET_OFFSET_MIN = 0
export const WIDGET_OFFSET_MAX = 200
export const WIDGET_OFFSET_DEFAULT = 20

/** Coerce an arbitrary value into a valid position, defaulting to bottom-right. */
export function normalizeWidgetPosition(value: unknown): WidgetPosition {
  return typeof value === 'string' && (WIDGET_POSITIONS as readonly string[]).includes(value)
    ? (value as WidgetPosition)
    : WIDGET_POSITION_DEFAULT
}

/** Clamp an arbitrary value into the allowed px spacing range. */
export function normalizeWidgetOffset(value: unknown, fallback: number = WIDGET_OFFSET_DEFAULT): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(WIDGET_OFFSET_MIN, Math.min(WIDGET_OFFSET_MAX, Math.round(n)))
}

/** 'bottom-right' → 'bottom'. Drives which edge the panel opens away from. */
export function verticalAnchor(position: WidgetPosition): 'top' | 'middle' | 'bottom' {
  return position.split('-')[0] as 'top' | 'middle' | 'bottom'
}

/** 'bottom-right' → 'right'. Drives which edge the bubble hugs. */
export function horizontalAnchor(position: WidgetPosition): 'left' | 'right' {
  return position.split('-')[1] as 'left' | 'right'
}

/** Vertical spacing has no effect on the middle-* anchors (viewport-centered). */
export function isVerticallyCentered(position: WidgetPosition): boolean {
  return verticalAnchor(position) === 'middle'
}
