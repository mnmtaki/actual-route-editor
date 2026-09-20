import type { ProjectSettings } from '../data/model'
import { DEFAULT_SETTINGS } from '../data/model'

/**
 * These are the actual defaults from AARC's current configStore.ts.
 * Keep source semantics here; do not replace them with browser measurements.
 */
export const AARC_DEFAULT_LINE_WIDTH = 14
export const AARC_DEFAULT_STATION_RADIUS = 10
export const AARC_DEFAULT_STATION_STROKE_WIDTH = 4
export const AARC_DEFAULT_STATION_NAME_FONT_SIZE = 26
export const AARC_DEFAULT_STATION_NAME_ROW_HEIGHT = 30
export const AARC_DEFAULT_STATION_SUB_NAME_FONT_SIZE = 18
export const AARC_DEFAULT_STATION_SUB_NAME_ROW_HEIGHT = 20

export interface AarcVisualMultipliers {
  lineWidth: number
  stationSize: number
  stationNameSize: number
  stationSnapSize: number
  stationNameSnapSize: number
  selectedWidthKey: string
  distinctLineWidths: number[]
}

export interface AarcVisualCalibration {
  settings: Pick<ProjectSettings,
    'lineWidth' | 'stationSize' | 'transferMinorAxis' | 'transferEndPadding' |
    'transferDotGap' | 'stationLabelSize' | 'stationLabelFontFamily' | 'stationLabelFontWeight' | 'stationLabelColor' |
    'stationForeignLabelSize' | 'stationForeignLabelFontFamily' | 'stationForeignLabelFontWeight' | 'stationForeignLabelColor' | 'foreignLabelGap' | 'aarcLineWidthReferenceRatio'>
  multipliers: AarcVisualMultipliers
  stationRadius: number
  stationStrokeWidth: number
  mainRowHeight: number
  subRowHeight: number
}

interface AarcVisualLine { width?: unknown }
interface AarcLineWidthMapping { staSize?: unknown; staNameSize?: unknown; staSnapSize?: unknown; staNameSnapSize?: unknown }

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}
function positive(value: unknown): number | null {
  const number = finite(value)
  return number !== null && number > 0 ? number : null
}
function configObject(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {}
}
function configPositive(config: unknown, key: string, fallback: number) {
  return positive(configObject(config)[key]) ?? fallback
}
function configString(config: unknown, key: string, fallback: string) {
  const value = configObject(config)[key]
  return typeof value === 'string' && value ? value : fallback
}

function readMapping(config: unknown, width: number): { key: string; mapping: AarcLineWidthMapping } | null {
  const raw = configObject(config).lineWidthMapped
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
  // Mirrors AARC saveStore: per-line override -> lineWidthMapped -> line.width.
  const stationSize = positive(resolved?.mapping.staSize) ?? lineWidth
  const stationNameSize = positive(resolved?.mapping.staNameSize) ?? lineWidth
  const stationSnapSize = finite(resolved?.mapping.staSnapSize) ?? stationSize
  const stationNameSnapSize = finite(resolved?.mapping.staNameSnapSize) ?? stationSize
  return { lineWidth, stationSize, stationNameSize, stationSnapSize, stationNameSnapSize, selectedWidthKey: resolved?.key ?? String(lineWidth), distinctLineWidths }
}

export function convertAarcVisualStyle(lines: AarcVisualLine[], config: unknown): AarcVisualCalibration | null {
  const multipliers = resolveAarcVisualMultipliers(lines, config)
  if (!multipliers) return null

  const lineWidthBase = configPositive(config, 'lineWidth', AARC_DEFAULT_LINE_WIDTH)
  const stationRadiusBase = configPositive(config, 'ptStaSize', AARC_DEFAULT_STATION_RADIUS)
  const stationStrokeBase = configPositive(config, 'ptStaLineWidth', AARC_DEFAULT_STATION_STROKE_WIDTH)
  const stationNameFontSizeBase = configPositive(config, 'staNameFontSize', AARC_DEFAULT_STATION_NAME_FONT_SIZE)
  const stationNameRowHeightBase = configPositive(config, 'staNameRowHeight', AARC_DEFAULT_STATION_NAME_ROW_HEIGHT)
  const stationSubFontSizeBase = configPositive(config, 'staNameSubFontSize', AARC_DEFAULT_STATION_SUB_NAME_FONT_SIZE)
  const stationSubRowHeightBase = configPositive(config, 'staNameSubRowHeight', AARC_DEFAULT_STATION_SUB_NAME_ROW_HEIGHT)
  const stationNameFontWeight = resolveAarcFontWeight(config)
  const stationNameFontFamily = configString(config, 'staNameFont', 'sans-serif')
  const stationSubFontFamily = configString(config, 'staNameSubFont', stationNameFontFamily)

  // Actual Route stores ordinary station size as a diameter; AARC stores
  // ptStaSize as a radius. Line width remains the AARC config base (14 by
  // default); imported Line.source.sourceWidthRatio applies line.width later.
  const stationRadius = stationRadiusBase * multipliers.stationSize
  const stationStrokeWidth = stationStrokeBase * multipliers.stationSize
  const stationSize = stationRadius * 2
  const stationLabelSize = stationNameFontSizeBase * multipliers.stationNameSize
  const stationForeignLabelSize = stationSubFontSizeBase * multipliers.stationNameSize
  const mainRowHeight = stationNameRowHeightBase * multipliers.stationNameSize
  const subRowHeight = stationSubRowHeightBase * multipliers.stationNameSize

  return {
    settings: {
      lineWidth: lineWidthBase,
      aarcLineWidthReferenceRatio: 1,
      stationSize,
      // AARC transfer clusters have different geometry from Actual Route's
      // capsule transfer renderer. Keep native transfer controls stable rather
      // than deriving fake values from the line width.
      transferMinorAxis: DEFAULT_SETTINGS.transferMinorAxis,
      transferEndPadding: DEFAULT_SETTINGS.transferEndPadding,
      transferDotGap: DEFAULT_SETTINGS.transferDotGap,
      stationLabelSize,
      stationLabelFontFamily: stationNameFontFamily,
      stationLabelFontWeight: stationNameFontWeight,
      stationLabelColor: configString(config, 'staNameColor', '#000000'),
      stationForeignLabelSize,
      stationForeignLabelFontFamily: stationSubFontFamily,
      stationForeignLabelFontWeight: resolveAarcSubFontWeight(config, stationNameFontWeight),
      stationForeignLabelColor: configString(config, 'staNameSubColor', '#888888'),
      // AARC uses explicit main/sub row heights rather than a free-standing gap.
      foreignLabelGap: 0,
    },
    multipliers,
    stationRadius,
    stationStrokeWidth,
    mainRowHeight,
    subRowHeight,
  }
}

function resolveAarcFontWeight(config:unknown){
  const value=configObject(config).staNameFontWeight
  if(value==='bold')return 700
  if(value==='normal')return 400
  const numeric=typeof value==='number'?value:Number(value)
  return Number.isFinite(numeric)&&numeric>=100&&numeric<=900?numeric:400
}
function resolveAarcSubFontWeight(config: unknown, fallback: number) {
  const value = configObject(config).staNameSubFontWeight
  if (value === 'bold') return 700
  if (value === 'normal') return 400
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric >= 100 && numeric <= 900 ? numeric : fallback
}

export type AarcLabelHorizontalAlign = 'start' | 'middle' | 'end'
export type AarcLabelVerticalAlign = 'top' | 'middle' | 'bottom'

export function resolveAarcLabelAnchor(nameP: readonly [number, number], epsilon = 1e-6) {
  const [anchorX, anchorY] = nameP
  const horizontalAlign: AarcLabelHorizontalAlign = anchorX > epsilon ? 'start' : anchorX < -epsilon ? 'end' : 'middle'
  const verticalAlign: AarcLabelVerticalAlign = anchorY > epsilon ? 'top' : anchorY < -epsilon ? 'bottom' : 'middle'
  return { anchorX, anchorY, horizontalAlign, verticalAlign }
}

/** AARC anchors directly on nameP; no browser-measured correction belongs here. */
export function getAarcLabelAlignmentOffset(_horizontalAlign: AarcLabelHorizontalAlign, _verticalAlign: AarcLabelVerticalAlign) {
  return { x: 0, y: 0 }
}

/**
 * Mirror AARC drawText row geometry. SVG text is positioned at each row center
 * (with dominantBaseline=middle in StationLabel), so no measured glyph magic
 * numbers are needed.
 */
export function getAarcLabelBlockMetrics(labelSize: number, _foreignLabelSize: number, _foreignLabelGap: number, foreignLineCount: number) {
  const ratio = labelSize > 0 ? labelSize / AARC_DEFAULT_STATION_NAME_FONT_SIZE : 1
  const mainRowHeight = AARC_DEFAULT_STATION_NAME_ROW_HEIGHT * ratio
  const subRowHeight = AARC_DEFAULT_STATION_SUB_NAME_ROW_HEIGHT * ratio
  const height = mainRowHeight + foreignLineCount * subRowHeight
  return {
    height,
    primaryBaseline: mainRowHeight / 2,
    foreignBaselines: Array.from({ length: foreignLineCount }, (_, index) => mainRowHeight + (index + .5) * subRowHeight),
  }
}
