'use client'

import {
  isVerticallyCentered,
  WIDGET_OFFSET_MAX,
  WIDGET_OFFSET_MIN,
  type WidgetPosition,
} from '@/lib/widget/position'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

/** The six anchors, laid out as they appear on screen (rows = vertical band). */
const ANCHOR_GRID: { position: WidgetPosition; label: string }[][] = [
  [
    { position: 'top-left', label: 'Top left' },
    { position: 'top-right', label: 'Top right' },
  ],
  [
    { position: 'middle-left', label: 'Middle left' },
    { position: 'middle-right', label: 'Middle right' },
  ],
  [
    { position: 'bottom-left', label: 'Bottom left' },
    { position: 'bottom-right', label: 'Bottom right' },
  ],
]

/** Preview viewport size, in px. The bubble scales down proportionally. */
const STAGE_W = 260
const STAGE_H = 150
/** The live widget bubble is 56px on a ~1280px-wide viewport. */
const SCALE = STAGE_W / 1280
const BUBBLE = Math.round(56 * SCALE) // ≈ 11px

interface WidgetPlacementEditorProps {
  position: WidgetPosition
  offsetX: number
  offsetY: number
  onPositionChange: (position: WidgetPosition) => void
  onOffsetXChange: (value: number) => void
  onOffsetYChange: (value: number) => void
  disabled?: boolean
}

/**
 * Anchor picker + spacing sliders with a live scaled preview of where the bubble
 * lands. Mirrors the widget's own CSS: `middle-*` centers on the viewport, so the
 * vertical spacing control is disabled there rather than silently ignored.
 */
export function WidgetPlacementEditor({
  position,
  offsetX,
  offsetY,
  onPositionChange,
  onOffsetXChange,
  onOffsetYChange,
  disabled = false,
}: WidgetPlacementEditorProps) {
  const centered = isVerticallyCentered(position)
  const [vertical, horizontal] = position.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'right']

  // Same math the widget CSS does, just scaled into the preview stage.
  const scaledX = offsetX * SCALE
  const scaledY = offsetY * SCALE
  const bubbleStyle: React.CSSProperties = {
    width: BUBBLE,
    height: BUBBLE,
    ...(horizontal === 'right' ? { right: scaledX } : { left: scaledX }),
    ...(vertical === 'bottom'
      ? { bottom: scaledY }
      : vertical === 'top'
        ? { top: scaledY }
        : { top: `calc(50% - ${BUBBLE / 2}px)` }),
  }

  return (
    <div className="space-y-4 rounded-[10px] border border-border bg-bg-secondary/40 p-4">
      <div>
        <p className="text-sm font-medium">Position on screen</p>
        <p className="text-[12.5px] text-text-tertiary">
          Where the chat bubble sits on the visitor&apos;s page.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        {/* Anchor picker — laid out like the screen it maps to. */}
        <div
          className="grid shrink-0 grid-cols-2 gap-1.5"
          role="radiogroup"
          aria-label="Widget position on screen"
        >
          {ANCHOR_GRID.flat().map(({ position: value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={position === value}
              aria-label={label}
              title={label}
              disabled={disabled}
              onClick={() => onPositionChange(value)}
              className={cn(
                'relative h-11 w-[68px] rounded-md border transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                position === value
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-background hover:border-accent/50',
              )}
            >
              {/* Dot in the corner this anchor represents. */}
              <span
                className={cn(
                  'absolute h-2 w-2 rounded-full',
                  position === value ? 'bg-accent' : 'bg-zinc-400',
                  value.endsWith('-left') ? 'left-1.5' : 'right-1.5',
                  value.startsWith('top-')
                    ? 'top-1.5'
                    : value.startsWith('bottom-')
                      ? 'bottom-1.5'
                      : 'top-1/2 -translate-y-1/2',
                )}
              />
            </button>
          ))}
        </div>

        {/* Live preview of the resulting placement. */}
        <div
          className="relative shrink-0 overflow-hidden rounded-md border border-border bg-background"
          style={{ width: STAGE_W, height: STAGE_H }}
          aria-hidden="true"
        >
          {/* Fake browser chrome, so the stage reads as a page. */}
          <div className="flex h-4 items-center gap-1 border-b border-border bg-bg-secondary/60 px-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
          </div>
          <div className="absolute inset-x-0 bottom-0 top-4">
            <div
              className="absolute rounded-full shadow-sm ring-1 ring-black/10"
              style={{ ...bubbleStyle, backgroundColor: 'var(--accent, #18181B)' }}
            />
          </div>
        </div>
      </div>

      {/* Spacing */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SpacingField
          label="Horizontal spacing"
          hint="Gap from the left or right edge."
          value={offsetX}
          onChange={onOffsetXChange}
          disabled={disabled}
        />
        <SpacingField
          label="Vertical spacing"
          hint={
            centered
              ? 'Not used — a middle anchor centers on the viewport.'
              : 'Gap from the top or bottom edge.'
          }
          value={offsetY}
          onChange={onOffsetYChange}
          disabled={disabled || centered}
        />
      </div>
    </div>
  )
}

function SpacingField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  function commit(next: number) {
    if (!Number.isFinite(next)) return
    onChange(Math.max(WIDGET_OFFSET_MIN, Math.min(WIDGET_OFFSET_MAX, Math.round(next))))
  }

  return (
    <div className={cn('space-y-2', disabled && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-[13px] font-medium">{label}</label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={WIDGET_OFFSET_MIN}
            max={WIDGET_OFFSET_MAX}
            value={value}
            disabled={disabled}
            onChange={(e) => commit(e.target.valueAsNumber)}
            className="h-7 w-16 px-2 text-right text-[12.5px]"
            aria-label={label}
          />
          <span className="text-[12px] text-text-tertiary">px</span>
        </div>
      </div>
      <Slider
        min={WIDGET_OFFSET_MIN}
        max={WIDGET_OFFSET_MAX}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={([next]) => commit(next)}
        aria-label={label}
      />
      <p className="text-[11.5px] text-text-tertiary">{hint}</p>
    </div>
  )
}
