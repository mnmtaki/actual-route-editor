import { normalizeISODate } from '../timeline/date'

export interface AarcTemporalLine {
  id?: unknown
  pts?: unknown
  time?: { open?: unknown; close?: unknown }
}

export interface AarcTemporalSlice {
  id?: unknown
  line?: unknown
  fromPt?: unknown
  toPt?: unknown
  time?: { open?: unknown; close?: unknown }
}

export interface AarcAtomicDate {
  openedAt: string | null
  closedAt: string | null
}

const AARC_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000
const MIN_AARC_TIMESTAMP = Date.UTC(1800, 0, 1)
const MAX_AARC_TIMESTAMP = Date.UTC(2500, 11, 31, 23, 59, 59, 999)

/**
 * AARC stores calendar timestamps as epoch milliseconds in UTC+8.  Convert
 * only values in a conservative, real-world range; malformed/ancient values
 * are ignored rather than being turned into misleading dates.
 */
export function decodeAarcTimestamp(value: unknown): string | null {
  const normalized = normalizeISODate(value)
  if (normalized) return normalized
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric < MIN_AARC_TIMESTAMP || numeric > MAX_AARC_TIMESTAMP) return null
  const shifted = new Date(numeric + AARC_TIME_ZONE_OFFSET_MS)
  if (Number.isNaN(shifted.getTime()) || shifted.getUTCFullYear() < 1800 || shifted.getUTCFullYear() > 2500) return null
  return shifted.toISOString().slice(0, 10)
}

/** Resolve one AARC line's point chain to atomic adjacent-leg dates. */
export function resolveAarcAtomicDates(
  line: AarcTemporalLine,
  slices: AarcTemporalSlice[],
  baseOpenedAt: string | null,
  baseClosedAt: string | null,
  warnings: string[],
): AarcAtomicDate[] {
  const pointIds = Array.isArray(line.pts) ? line.pts.map(toFiniteId) : []
  const legDates = Array.from({ length: Math.max(0, pointIds.length - 1) }, () => ({ openedAt: baseOpenedAt, closedAt: baseClosedAt }))
  const lineId = toFiniteId(line.id)
  if (lineId === null) return legDates
  const firstIndexByPoint = new Map<number, number>()
  pointIds.forEach((pointId, index) => { if (pointId !== null && !firstIndexByPoint.has(pointId)) firstIndexByPoint.set(pointId, index) })

  slices.forEach((slice, sliceIndex) => {
    if (toFiniteId(slice.line) !== lineId) return
    const sliceId = toFiniteId(slice.id)
    const label = sliceId === null ? `第 ${sliceIndex + 1} 个时间片` : `时间片 ${sliceId}`
    const openedAt = decodeAarcTimestamp(slice.time?.open)
    const closedAt = decodeAarcTimestamp(slice.time?.close)
    if (slice.time?.open != null && !openedAt) warnings.push(`AARC ${label} 的 time.open 无法可靠换算为日期，已忽略`)
    if (slice.time?.close != null && !closedAt) warnings.push(`AARC ${label} 的 time.close 无法可靠换算为日期，已忽略`)
    const fromPoint = toFiniteId(slice.fromPt), toPoint = toFiniteId(slice.toPt)
    const fromIndex = fromPoint === null ? undefined : firstIndexByPoint.get(fromPoint)
    const toIndex = toPoint === null ? undefined : firstIndexByPoint.get(toPoint)
    if (fromIndex === undefined || toIndex === undefined) {
      warnings.push(`AARC ${label} 未能在线路 ${lineId} 的 pts 中找到 fromPt/toPt，已忽略`)
      return
    }
    const start = Math.min(fromIndex, toIndex), end = Math.max(fromIndex, toIndex)
    for (let index = start; index < end && index < legDates.length; index += 1) {
      if (openedAt) legDates[index].openedAt = openedAt
      if (closedAt) legDates[index].closedAt = closedAt
    }
  })
  return legDates
}

/** Aggregate a station-to-station Segment over the atomic legs it contains. */
export function aggregateAarcInterval(
  legDates: AarcAtomicDate[],
  fromIndex: number,
  toIndex: number,
  fallback: AarcAtomicDate,
): AarcAtomicDate {
  const start = Math.min(fromIndex, toIndex), end = Math.max(fromIndex, toIndex)
  const legs = legDates.slice(start, end)
  const openedDates = legs.map(item => item.openedAt).filter((value): value is string => Boolean(value))
  const closedDates = legs.map(item => item.closedAt).filter((value): value is string => Boolean(value))
  return {
    openedAt: openedDates.length ? openedDates.reduce(maxDate) : fallback.openedAt,
    closedAt: closedDates.length ? closedDates.reduce(minDate) : fallback.closedAt,
  }
}

function toFiniteId(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
function maxDate(left: string, right: string) { return left >= right ? left : right }
function minDate(left: string, right: string) { return left <= right ? left : right }
