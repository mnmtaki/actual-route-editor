import type { ActualRouteProject, Line, LineLegend, Station } from './model'
import { uid } from './model'

export const DEFAULT_LINE_LEGEND: Omit<LineLegend, 'id' | 'x' | 'y'> = {
  scale: 1,
  visible: true,
  locked: false,
  title: '线路',
  foreignTitle: 'Line',
  mode: 'auto',
  lineIds: [],
  columns: 4,
  showForeignLineName: true,
  showTerminals: true,
  showForeignTerminals: true,
  backgroundEnabled: false,
  backgroundColor: '#fffdf8',
  backgroundOpacity: 0.94,
  padding: 18,
  columnWidth: 230,
  rowGap: 18,
  columnGap: 34,
}

export interface LineLegendItem {
  lineId: string
  lineName: string
  foreignLineName: string
  firstStation: string
  lastStation: string
  firstStationForeign: string
  lastStationForeign: string
  isRing: boolean
  singleStation: boolean
}

export interface LineLegendLayoutItem extends LineLegendItem {
  x: number
  y: number
  width: number
  height: number
}

export interface LineLegendLayout {
  width: number
  height: number
  titleHeight: number
  itemHeight: number
  padding: number
  columns: number
  items: LineLegendLayoutItem[]
}

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const positive = (value: unknown, fallback: number) => Math.max(0.01, finite(value, fallback))
const nonNegative = (value: unknown, fallback: number) => Math.max(0, finite(value, fallback))
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

export function normalizeLineLegend(value: unknown): LineLegend | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return undefined
  const mode = raw.mode === 'custom' ? 'custom' : 'auto'
  return {
    id: raw.id,
    x: finite(raw.x, 0),
    y: finite(raw.y, 0),
    scale: positive(raw.scale, DEFAULT_LINE_LEGEND.scale),
    visible: raw.visible !== false,
    locked: raw.locked === true,
    title: typeof raw.title === 'string' ? raw.title : DEFAULT_LINE_LEGEND.title,
    foreignTitle: typeof raw.foreignTitle === 'string' ? raw.foreignTitle : DEFAULT_LINE_LEGEND.foreignTitle,
    mode,
    lineIds: Array.isArray(raw.lineIds) ? raw.lineIds.filter((id): id is string => typeof id === 'string') : [],
    columns: Math.max(1, Math.min(8, Math.round(finite(raw.columns, DEFAULT_LINE_LEGEND.columns)))),
    showForeignLineName: bool(raw.showForeignLineName, DEFAULT_LINE_LEGEND.showForeignLineName),
    showTerminals: bool(raw.showTerminals, DEFAULT_LINE_LEGEND.showTerminals),
    showForeignTerminals: bool(raw.showForeignTerminals, DEFAULT_LINE_LEGEND.showForeignTerminals),
    backgroundEnabled: bool(raw.backgroundEnabled, DEFAULT_LINE_LEGEND.backgroundEnabled),
    backgroundColor: typeof raw.backgroundColor === 'string' && raw.backgroundColor ? raw.backgroundColor : DEFAULT_LINE_LEGEND.backgroundColor,
    backgroundOpacity: Math.max(0, Math.min(1, finite(raw.backgroundOpacity, DEFAULT_LINE_LEGEND.backgroundOpacity))),
    padding: nonNegative(raw.padding, DEFAULT_LINE_LEGEND.padding),
    columnWidth: Math.max(90, finite(raw.columnWidth, DEFAULT_LINE_LEGEND.columnWidth)),
    rowGap: nonNegative(raw.rowGap, DEFAULT_LINE_LEGEND.rowGap),
    columnGap: nonNegative(raw.columnGap, DEFAULT_LINE_LEGEND.columnGap),
  }
}

export function createLineLegend(project: ActualRouteProject, point: { x: number; y: number }): { project: ActualRouteProject; legendId: string | null } {
  const next = structuredClone(project)
  if (next.lineLegend) return { project: next, legendId: next.lineLegend.id }
  const id = uid('line_legend')
  next.lineLegend = { id, x: point.x, y: point.y, ...DEFAULT_LINE_LEGEND }
  return { project: next, legendId: id }
}

export function getLegendLines(project: ActualRouteProject, legend: LineLegend): Line[] {
  const selected = legend.mode === 'custom' ? new Set(legend.lineIds) : undefined
  return project.lines.filter(line => line.visible && (!selected || selected.has(line.id)))
}

export function displayLineName(line: Line): string {
  const value = line.name.trim()
  return /^\d+$/.test(value) ? `${value}号线` : value
}

export function displayForeignLineName(line: Line): string {
  const value = line.name.trim()
  const numeric = value.match(/^(\d+)(?:号线)?$/)
  if (numeric) return `Line ${numeric[1]}`
  if (value.includes('环')) return 'Loop Line'
  return ''
}

export function isRingLine(project: ActualRouteProject, line: Line): boolean {
  const sequence = line.stationSequence
  if (sequence.length < 2) return false
  const first = sequence[0], last = sequence[sequence.length - 1]
  return project.geometry.segments.some(segment => segment.lineId === line.id && ((segment.fromStationId === first && segment.toStationId === last) || (segment.fromStationId === last && segment.toStationId === first)))
}

function stationName(station: Station | undefined) { return station?.name?.trim() ?? '' }
function stationForeignName(station: Station | undefined) { return station?.nameS?.trim() ?? '' }

export function getLegendItem(project: ActualRouteProject, line: Line): LineLegendItem | null {
  const sequence = line.stationSequence
  const first = project.stations.find(station => station.id === sequence[0])
  const last = project.stations.find(station => station.id === sequence[sequence.length - 1])
  if (sequence.length && !first && !last) return null
  const ring = isRingLine(project, line)
  const singleStation = sequence.length === 1
  return {
    lineId: line.id,
    lineName: displayLineName(line),
    foreignLineName: displayForeignLineName(line),
    firstStation: stationName(first),
    lastStation: ring || singleStation ? stationName(first) : stationName(last),
    firstStationForeign: stationForeignName(first),
    lastStationForeign: ring || singleStation ? stationForeignName(first) : stationForeignName(last),
    isRing: ring,
    singleStation,
  }
}

export function getLineLegendItems(project: ActualRouteProject, legend: LineLegend): LineLegendItem[] {
  return getLegendLines(project, legend).map(line => getLegendItem(project, line)).filter((item): item is LineLegendItem => Boolean(item))
}

export function getLineLegendLayout(project: ActualRouteProject, legend: LineLegend): LineLegendLayout {
  const padding = Math.max(0, legend.padding)
  const columns = Math.max(1, Math.min(8, Math.round(legend.columns)))
  const items = getLineLegendItems(project, legend)
  const titleHeight = (legend.title || legend.foreignTitle) ? (legend.title && legend.foreignTitle ? 58 : 36) : 10
  const itemHeights = items.map(item => {
    let height = 26
    if (item.foreignLineName && legend.showForeignLineName) height += 18
    if (legend.showTerminals && (item.firstStation || item.lastStation)) {
      height += 20
      if (legend.showForeignTerminals && (item.firstStationForeign || item.lastStationForeign)) height += 16
    }
    return height + 8
  })
  const itemHeight = Math.max(48, ...itemHeights)
  const rows = Math.ceil(items.length / columns)
  const width = Math.max(1, padding * 2 + Math.max(1, Math.min(columns, items.length || 1)) * legend.columnWidth + Math.max(0, Math.min(columns, items.length || 1) - 1) * legend.columnGap)
  const height = Math.max(1, padding * 2 + titleHeight + (rows ? rows * itemHeight + Math.max(0, rows - 1) * legend.rowGap : 0))
  return {
    width,
    height,
    titleHeight,
    itemHeight,
    padding,
    columns,
    items: items.map((item, index) => ({ ...item, x: padding + (index % columns) * (legend.columnWidth + legend.columnGap), y: padding + titleHeight + Math.floor(index / columns) * (itemHeight + legend.rowGap), width: legend.columnWidth, height: itemHeight })),
  }
}

export function getLineLegendWorldBounds(project: ActualRouteProject, legend: LineLegend): { x: number; y: number; width: number; height: number } {
  const layout = getLineLegendLayout(project, legend)
  return { x: legend.x, y: legend.y, width: layout.width * legend.scale, height: layout.height * legend.scale }
}
