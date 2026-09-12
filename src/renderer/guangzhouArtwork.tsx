import type { CSSProperties } from 'react'

/**
 * The Guangzhou presets all use the same small bilingual service pill.  This
 * primitive deliberately knows nothing about transfer topology; callers only
 * provide the passenger-facing service code, station code and display color.
 */
export interface GuangzhouStationPillMetrics {
  width: number
  height: number
  cellWidth: number
  radius: number
}

export interface GuangzhouStationPillProps {
  x: number
  y: number
  lineCode?: string
  stationCode?: string
  serviceColor?: string
  lineId?: string
  width?: number
  height?: number
  strokeWidth?: number
  className?: string
}

const DEFAULT_STROKE = '#596161'
const DEFAULT_HEIGHT = 18
const MIN_CELL_WIDTH = 20
const HORIZONTAL_TEXT_PADDING = 7
const APPROX_GLYPH_WIDTH = 5.8

function clean(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function textWidth(value: string): number {
  return Math.max(MIN_CELL_WIDTH - HORIZONTAL_TEXT_PADDING, value.length * APPROX_GLYPH_WIDTH + HORIZONTAL_TEXT_PADDING)
}

/** Return deterministic dimensions shared by ordinary and transfer pills. */
export function getGuangzhouStationPillMetrics(lineCode = '', stationCode = '', width?: number, height = DEFAULT_HEIGHT): GuangzhouStationPillMetrics {
  const left = clean(lineCode), right = clean(stationCode)
  const naturalCellWidth = Math.max(MIN_CELL_WIDTH, textWidth(left), textWidth(right))
  const cellWidth = Math.max(naturalCellWidth, Number.isFinite(width) ? (width as number) / 2 : 0)
  const resolvedHeight = Math.max(16, Number.isFinite(height) ? height : DEFAULT_HEIGHT)
  return { width: cellWidth * 2, height: resolvedHeight, cellWidth, radius: resolvedHeight / 2 }
}

function fontSize(value: string, metrics: GuangzhouStationPillMetrics): number {
  if (!value) return Math.max(4, Math.min(10, metrics.height * .52))
  const available = Math.max(5, metrics.cellWidth - HORIZONTAL_TEXT_PADDING)
  return Math.max(4, Math.min(10, metrics.height * .52, available / (value.length * .62)))
}

/**
 * Shared Guangzhou station artwork.  The outer pill remains white; only its
 * border and divider carry the passenger-facing service color.
 */
export function GuangzhouStationPill({ x, y, lineCode = '', stationCode = '', serviceColor = DEFAULT_STROKE, lineId, width, height = DEFAULT_HEIGHT, strokeWidth = 1.25, className }: GuangzhouStationPillProps) {
  const left = clean(lineCode), right = clean(stationCode)
  const metrics = getGuangzhouStationPillMetrics(left, right, width, height)
  const textStyle: CSSProperties = { fontFamily: 'inherit' }
  return <g className={className} data-guangzhou-pill="true" data-line-id={lineId} data-guangzhou-pill-line-code={left} data-guangzhou-pill-station-code={right}>
    <rect data-guangzhou-pill-background="true" data-station-shape="capsule" x={x - metrics.width / 2} y={y - metrics.height / 2} width={metrics.width} height={metrics.height} rx={metrics.radius} fill="white" stroke={serviceColor || DEFAULT_STROKE} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    <line data-guangzhou-divider="true" x1={x} y1={y - metrics.height / 2 + strokeWidth} x2={x} y2={y + metrics.height / 2 - strokeWidth} stroke={serviceColor || DEFAULT_STROKE} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    <text className="station-number-pill-label" data-guangzhou-pill-line="true" x={x - metrics.cellWidth / 2} y={y + fontSize(left, metrics) * .35} textAnchor="middle" fill="#202526" fontSize={fontSize(left, metrics)} fontWeight="700" style={textStyle}>{left}</text>
    <text className="station-number-pill-label" data-guangzhou-pill-station="true" x={x + metrics.cellWidth / 2} y={y + fontSize(right, metrics) * .35} textAnchor="middle" fill="#202526" fontSize={fontSize(right, metrics)} fontWeight="700" style={textStyle}>{right}</text>
  </g>
}

