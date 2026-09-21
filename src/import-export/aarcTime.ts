import { normalizeISODate } from '../timeline/date'

export interface AarcLineTimeInfo {
  propose?: unknown
  construct?: unknown
  open?: unknown
  suspend?: unknown
  abandon?: unknown
  /** Legacy compatibility for older/non-current saves. Current AARC uses abandon. */
  close?: unknown
}

export interface AarcTemporalLine {
  id?: unknown
  pts?: unknown
  time?: AarcLineTimeInfo
}

export interface AarcTemporalSlice {
  id?: unknown
  line?: unknown
  fromPt?: unknown
  toPt?: unknown
  time?: AarcLineTimeInfo
}

export interface AarcStyleSlice extends AarcTemporalSlice { style?: unknown }

export interface AarcDecodedSuspension {
  start: string
  end: string
}

export interface AarcDecodedTimeInfo {
  proposedAt: string | null
  constructionStartedAt: string | null
  openedAt: string | null
  closedAt: string | null
  suspensions: AarcDecodedSuspension[]
}

export interface AarcAtomicDate {
  openedAt: string | null
  closedAt: string | null
  /** Only slice-local suspensions live here; line-level suspensions are stored on Line.operationHistory. */
  suspensions?: AarcDecodedSuspension[]
}

export function decodeAarcTimeInfo(
  time: AarcLineTimeInfo | undefined,
  warnings: string[] = [],
  label = 'AARC 时间',
): AarcDecodedTimeInfo {
  const decodeField = (key: 'propose' | 'construct' | 'open' | 'abandon' | 'close') => {
    const raw = time?.[key]
    if (raw === undefined || raw === null) return null
    const decoded = decodeAarcTimestamp(raw)
    if (!decoded) warnings.push(`${label}的 time.${key} 无法可靠换算为日期，已保留在 AARC 来源数据中但不映射到 ARE 时间轴`)
    return decoded
  }
  const proposedAt = decodeField('propose')
  const constructionStartedAt = decodeField('construct')
  const openedAt = decodeField('open')
  const abandonedAt = decodeField('abandon')
  const legacyClosedAt = abandonedAt ? null : decodeField('close')
  const suspensions: AarcDecodedSuspension[] = []
  if (time?.suspend !== undefined && time?.suspend !== null) {
    if (!Array.isArray(time.suspend)) {
      warnings.push(`${label}的 time.suspend 不是区间数组，已保留在 AARC 来源数据中但不映射到 ARE 运营历史`)
    } else {
      time.suspend.forEach((rawInterval, index) => {
        if (!Array.isArray(rawInterval) || rawInterval.length < 2) {
          warnings.push(`${label}的 time.suspend 第 ${index + 1} 项不是有效的起止区间，已保留原始数据`)
          return
        }
        const start = decodeAarcTimestamp(rawInterval[0])
        const end = decodeAarcTimestamp(rawInterval[1])
        if (!start || !end || start >= end) {
          warnings.push(`${label}的 time.suspend 第 ${index + 1} 项无法可靠换算为有效日期区间，已保留原始数据`)
          return
        }
        suspensions.push({ start, end })
      })
    }
  }
  suspensions.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  return { proposedAt, constructionStartedAt, openedAt, closedAt: abandonedAt ?? legacyClosedAt, suspensions }
}

/** Resolve a slice's point-id endpoints using AARC's singular-point rules.
 * A point can occur more than once on a loop.  Using the first occurrence for
 * both ends silently applies a slice to the wrong leg, so ambiguous
 * (two-singular) endpoints are rejected and the singular end is resolved
 * toward the non-singular endpoint.
 */
export function resolveAarcSliceEndpoints(pointIds: number[], fromPt: number, toPt: number): { fromIdx: number; toIdx: number } | undefined {
  if (fromPt === toPt) return undefined
  const occurrences = (value: number) => pointIds.reduce<number[]>((indices, point, index) => point === value ? [...indices, index] : indices, [])
  const fromIndices = occurrences(fromPt), toIndices = occurrences(toPt)
  if (!fromIndices.length || !toIndices.length) return undefined
  const fromSingular = fromIndices.length > 1, toSingular = toIndices.length > 1
  if (fromSingular && toSingular) return undefined
  let fromIdx: number, toIdx: number
  if (!fromSingular && !toSingular) {
    fromIdx = fromIndices[0]
    toIdx = toIndices[0]
  } else if (fromSingular) {
    toIdx = toIndices[0]
    fromIdx = fromIndices.reduce((best, index) => index <= toIdx && (best < 0 || toIdx - index < toIdx - best) ? index : best, -1)
    if (fromIdx < 0) return undefined
  } else {
    fromIdx = fromIndices[0]
    toIdx = toIndices.reduce((best, index) => index >= fromIdx && (best < 0 || index - fromIdx < best - fromIdx) ? index : best, -1)
    if (toIdx < 0) return undefined
  }
  return fromIdx <= toIdx ? { fromIdx, toIdx } : { fromIdx: toIdx, toIdx: fromIdx }
}

/** Resolve the deterministic style slice covering one station-to-station leg. */
export function resolveAarcStyleSliceForInterval(
  line: AarcTemporalLine,
  slices: AarcStyleSlice[],
  fromPt: number,
  toPt: number,
): { id: number | null; styleId: number | null } | undefined {
  const pointIds = Array.isArray(line.pts) ? line.pts.map(toFiniteId) : []
  if (pointIds.some(id => id === null)) return undefined
  const endpoints = resolveAarcSliceEndpoints(pointIds as number[], fromPt, toPt)
  if (!endpoints) return undefined
  const lineId = toFiniteId(line.id)
  if (lineId === null) return undefined
  const candidates = slices.flatMap((slice, index) => {
    if (toFiniteId(slice.line) !== lineId) return []
    const from = toFiniteId(slice.fromPt), to = toFiniteId(slice.toPt)
    if (from === null || to === null) return []
    const range = resolveAarcSliceEndpoints(pointIds as number[], from, to)
    if (!range || range.fromIdx > endpoints.fromIdx || range.toIdx < endpoints.toIdx) return []
    return [{ index, span: range.toIdx - range.fromIdx, id: toFiniteId(slice.id), styleId: toFiniteId(slice.style) }]
  })
  const selected = candidates.sort((a, b) => a.span - b.span || a.index - b.index)[0]
  return selected ? { id: selected.id, styleId: selected.styleId } : undefined
}

/** Resolve the narrowest source time slice covering one station-to-station leg.
 * The dates are already projected onto Segment.openedAt/closedAt by
 * resolveAarcAtomicDates; this helper only keeps the source slice identity for
 * diagnostics and future fidelity renderers.
 */
export function resolveAarcTimeSliceForInterval(
  line: AarcTemporalLine,
  slices: AarcTemporalSlice[],
  fromPt: number,
  toPt: number,
): { id: number | null } | undefined {
  const pointIds = Array.isArray(line.pts) ? line.pts.map(toFiniteId) : []
  if (pointIds.some(id => id === null)) return undefined
  const endpoints = resolveAarcSliceEndpoints(pointIds as number[], fromPt, toPt)
  if (!endpoints) return undefined
  const lineId = toFiniteId(line.id)
  if (lineId === null) return undefined
  const candidates = slices.flatMap((slice, index) => {
    if (toFiniteId(slice.line) !== lineId) return []
    const from = toFiniteId(slice.fromPt), to = toFiniteId(slice.toPt)
    if (from === null || to === null) return []
    const range = resolveAarcSliceEndpoints(pointIds as number[], from, to)
    if (!range || range.fromIdx > endpoints.fromIdx || range.toIdx < endpoints.toIdx) return []
    return [{ index, span: range.toIdx - range.fromIdx, id: toFiniteId(slice.id) }]
  })
  const selected = candidates.sort((a, b) => a.span - b.span || a.index - b.index)[0]
  return selected ? { id: selected.id } : undefined
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
  const legDates = Array.from({ length: Math.max(0, pointIds.length - 1) }, () => ({ openedAt: baseOpenedAt, closedAt: baseClosedAt, suspensions: [] as AarcDecodedSuspension[] }))
  const claimedBySlice = Array.from({ length: legDates.length }, () => false)
  const lineId = toFiniteId(line.id)
  if (lineId === null) return legDates
  slices.forEach((slice, sliceIndex) => {
    if (toFiniteId(slice.line) !== lineId) return
    const sliceId = toFiniteId(slice.id)
    const label = sliceId === null ? `AARC 第 ${sliceIndex + 1} 个时间片` : `AARC 时间片 ${sliceId}`
    const decoded = decodeAarcTimeInfo(slice.time, warnings, label)
    const fromPoint = toFiniteId(slice.fromPt), toPoint = toFiniteId(slice.toPt)
    const endpoints = fromPoint === null || toPoint === null ? undefined : resolveAarcSliceEndpoints(pointIds.filter((id): id is number => id !== null), fromPoint, toPoint)
    if (!endpoints) {
      warnings.push(`${label} 未能在线路 ${lineId} 的 pts 中找到 fromPt/toPt，已忽略`)
      return
    }
    const start = endpoints.fromIdx, end = endpoints.toIdx
    for (let index = start; index < end && index < legDates.length; index += 1) {
      // AARC getSpanTime uses TimeSlice as a complete override of Line.time.
      // Time slices are non-overlapping by contract; if malformed data overlaps,
      // source order wins just like the upstream first-match lookup.
      if (claimedBySlice[index]) continue
      legDates[index] = {
        openedAt: decoded.openedAt,
        closedAt: decoded.closedAt,
        suspensions: decoded.suspensions.map(item => ({ ...item })),
      }
      claimedBySlice[index] = true
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
  if (!legs.length) return fallback
  const openedDates = legs.map(item => item.openedAt).filter((value): value is string => Boolean(value))
  const closedDates = legs.map(item => item.closedAt).filter((value): value is string => Boolean(value))
  return {
    openedAt: openedDates.length ? openedDates.reduce(maxDate) : null,
    closedAt: closedDates.length ? closedDates.reduce(minDate) : null,
    suspensions: mergeSuspensions(legs.flatMap(item => item.suspensions ?? [])),
  }
}

function mergeSuspensions(intervals: AarcDecodedSuspension[]): AarcDecodedSuspension[] {
  const sorted = intervals
    .map(item => ({ ...item }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  const merged: AarcDecodedSuspension[] = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (!previous || interval.start > previous.end) {
      merged.push(interval)
      continue
    }
    if (interval.end > previous.end) previous.end = interval.end
  }
  return merged
}

function toFiniteId(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
function maxDate(left: string, right: string) { return left >= right ? left : right }
function minDate(left: string, right: string) { return left <= right ? left : right }
