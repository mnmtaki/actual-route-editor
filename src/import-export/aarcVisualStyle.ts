import type { ProjectSettings } from '../data/model'
import { DEFAULT_SETTINGS } from '../data/model'

export const AARC_COORDINATE_UNIT_TO_PX = 2.36
export const AARC_BASE_LINE_WIDTH = 14.69
export const AARC_BASE_STATION_DIAMETER = 15.5555555556
export const AARC_BASE_CHINESE_LABEL_VISUAL_HEIGHT = 25.42
export const AARC_FOREIGN_TO_CHINESE_VISUAL_RATIO = 0.68

// Edge 140, using the editor's real SVG font stack and weights. These are
// visible getBBox() metrics, not CSS em-box guesses.
export const AARC_SVG_CHINESE_VISIBLE_HEIGHT_PER_FONT_SIZE = 1.45
export const AARC_SVG_FOREIGN_VISIBLE_HEIGHT_PER_FONT_SIZE = 1.4756
export const AARC_SVG_GLYPH_TOP_FROM_BASELINE_PER_FONT_SIZE = 1.16

export interface AarcVisualMultipliers {
  lineWidth: number
  stationSize: number
  stationNameSize: number
  selectedWidthKey: string
  distinctLineWidths: number[]
}

export interface AarcVisualCalibration {
  settings: Pick<ProjectSettings,
    'lineWidth' | 'stationSize' | 'transferMinorAxis' | 'transferEndPadding' |
    'transferDotGap' | 'stationLabelSize' | 'stationForeignLabelSize' | 'foreignLabelGap'>
  multipliers: AarcVisualMultipliers
  chineseVisualHeight: number
  foreignVisualHeight: number
}

interface AarcVisualLine { width?: unknown }
interface AarcLineWidthMapping { staSize?: unknown; staNameSize?: unknown }

function positive(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function readMapping(config: unknown, width: number): { key: string; mapping: AarcLineWidthMapping } | null {
  if (!config || typeof config !== 'object') return null
  const raw = (config as { lineWidthMapped?: unknown }).lineWidthMapped
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  const entry = entries.find(([key]) => key === String(width))
    ?? entries.find(([key]) => positive(key) === width)
  if (!entry || !entry[1] || typeof entry[1] !== 'object') return null
  return { key: entry[0], mapping: entry[1] as AarcLineWidthMapping }
}

export function resolveAarcVisualMultipliers(lines: AarcVisualLine[], config: unknown): AarcVisualMultipliers | null {
  const distinctLineWidths = [...new Set(lines.map(line => positive(line.width)).filter((value): value is number => value !== null))]
  const lineWidth = distinctLineWidths[0]
  if (!lineWidth) return null
  const resolved = readMapping(config, lineWidth)
  if (!resolved) return null
  const stationSize = positive(resolved.mapping.staSize)
  const stationNameSize = positive(resolved.mapping.staNameSize)
  if (!stationSize || !stationNameSize) return null
  return { lineWidth, stationSize, stationNameSize, selectedWidthKey: resolved.key, distinctLineWidths }
}

export function convertAarcVisualStyle(lines: AarcVisualLine[], config: unknown): AarcVisualCalibration | null {
  const multipliers = resolveAarcVisualMultipliers(lines, config)
  if (!multipliers) return null
  const lineWidth = AARC_BASE_LINE_WIDTH * multipliers.lineWidth
  const stationSize = AARC_BASE_STATION_DIAMETER * multipliers.stationSize
  const chineseVisualHeight = AARC_BASE_CHINESE_LABEL_VISUAL_HEIGHT * multipliers.stationNameSize
  const foreignVisualHeight = chineseVisualHeight * AARC_FOREIGN_TO_CHINESE_VISUAL_RATIO
  const stationLabelSize = chineseVisualHeight / AARC_SVG_CHINESE_VISIBLE_HEIGHT_PER_FONT_SIZE
  const stationForeignLabelSize = foreignVisualHeight / AARC_SVG_FOREIGN_VISIBLE_HEIGHT_PER_FONT_SIZE
  const scaleFromEditorBaseline = lineWidth / DEFAULT_SETTINGS.lineWidth
  return {
    settings: {
      lineWidth,
      stationSize,
      transferMinorAxis: lineWidth * (DEFAULT_SETTINGS.transferMinorAxis / DEFAULT_SETTINGS.lineWidth),
      transferEndPadding: lineWidth * (DEFAULT_SETTINGS.transferEndPadding / DEFAULT_SETTINGS.lineWidth),
      transferDotGap: 5,
      stationLabelSize,
      stationForeignLabelSize,
      foreignLabelGap: DEFAULT_SETTINGS.foreignLabelGap * scaleFromEditorBaseline,
    },
    multipliers,
    chineseVisualHeight,
    foreignVisualHeight,
  }
}

export type AarcLabelHorizontalAlign = 'start' | 'middle' | 'end'
export type AarcLabelVerticalAlign = 'top' | 'middle' | 'bottom'

// Visible edge compensation measured from the real stroked SVG labels in Edge.
// nameP itself remains untouched; this only aligns the rendered ink bbox to it.
const AARC_LABEL_HORIZONTAL_EDGE_COMPENSATION: Record<AarcLabelHorizontalAlign, number> = { start: 0, middle: 0, end: -0.326 }
const AARC_LABEL_VERTICAL_EDGE_COMPENSATION: Record<AarcLabelVerticalAlign, number> = { top: 0.412, middle: 0.441, bottom: 0.47 }

export function resolveAarcLabelAnchor(nameP: readonly [number, number], epsilon = 1e-6) {
  const [anchorX, anchorY] = nameP
  const horizontalAlign: AarcLabelHorizontalAlign = anchorX > epsilon ? 'start' : anchorX < -epsilon ? 'end' : 'middle'
  const verticalAlign: AarcLabelVerticalAlign = anchorY > epsilon ? 'top' : anchorY < -epsilon ? 'bottom' : 'middle'
  return { anchorX, anchorY, horizontalAlign, verticalAlign }
}

export function getAarcLabelAlignmentOffset(horizontalAlign: AarcLabelHorizontalAlign, verticalAlign: AarcLabelVerticalAlign) {
  return { x: AARC_LABEL_HORIZONTAL_EDGE_COMPENSATION[horizontalAlign], y: AARC_LABEL_VERTICAL_EDGE_COMPENSATION[verticalAlign] }
}

export function getAarcLabelBlockMetrics(labelSize: number, foreignLabelSize: number, foreignLabelGap: number, foreignLineCount: number) {
  const primaryHeight = labelSize * AARC_SVG_CHINESE_VISIBLE_HEIGHT_PER_FONT_SIZE
  const primaryBaseline = labelSize * AARC_SVG_GLYPH_TOP_FROM_BASELINE_PER_FONT_SIZE
  if (!foreignLineCount) return { height: primaryHeight, primaryBaseline, foreignBaselines: [] as number[] }
  const foreignHeight = foreignLabelSize * AARC_SVG_FOREIGN_VISIBLE_HEIGHT_PER_FONT_SIZE
  const foreignTop = primaryHeight + foreignLabelGap
  const foreignAdvance = foreignLabelSize * 1.02
  return {
    height: foreignTop + foreignHeight + (foreignLineCount - 1) * foreignAdvance,
    primaryBaseline,
    foreignBaselines: Array.from({ length: foreignLineCount }, (_, index) =>
      foreignTop + foreignLabelSize * AARC_SVG_GLYPH_TOP_FROM_BASELINE_PER_FONT_SIZE + index * foreignAdvance),
  }
}
