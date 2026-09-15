import type { ActualRouteProject, Line, Segment } from '../data/model'
import { getStationAnchorForLine } from '../data/stationAnchor'

export interface AarcLinePathPoint { x: number; y: number; free?: boolean }
export interface AarcLinePathSpan { start: AarcLinePathPoint; control1: AarcLinePathPoint; control2: AarcLinePathPoint; end: AarcLinePathPoint; linear: boolean }

type WayRel = 'parallel' | '90' | '45' | '135'
type CornerPlan = { full: AarcLinePathSpan; left: AarcLinePathSpan; right: AarcLinePathSpan }

const EPS = 1e-4
const TURN_45_RATIO = 2.4142135 * .618

/**
 * Rebuild an imported AARC transit segment with AARC's own corner semantics.
 * The source line is split into AR Segments at stations, so a station corner is
 * split at the cubic midpoint: the incoming Segment owns the first half and the
 * outgoing Segment owns the second half. The two halves join exactly and keep
 * the AARC corner geometry continuous across the AR Segment boundary.
 *
 * Returns undefined for native AR segments so their existing modes stay intact.
 */
export function getAarcImportedSegmentPathSpans(project: ActualRouteProject, segment: Segment, resolvedLineId = segment.lineId): AarcLinePathSpan[] | undefined {
  if (segment.source?.format !== 'aarc') return undefined
  const line = project.lines.find(item => item.id === resolvedLineId) ?? project.lines.find(item => item.id === segment.lineId)
  if (!line || line.source?.format !== 'aarc') return undefined
  const points = getAarcSegmentPoints(project, segment, resolvedLineId)
  if (points.length < 2) return []

  const startPlan = buildBoundaryCorner(project, segment, line, points, 'start', resolvedLineId)
  const endPlan = buildBoundaryCorner(project, segment, line, points, 'end', resolvedLineId)
  const spans: AarcLinePathSpan[] = []
  let cursor = startPlan?.right.start ?? points[0]

  if (startPlan) {
    spans.push(startPlan.right)
    cursor = startPlan.right.end
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const plan = buildCornerPlan(project, line, points[index - 1], points[index], points[index + 1])
    if (!plan) continue
    pushLinear(spans, cursor, plan.full.start)
    spans.push(plan.full)
    cursor = plan.full.end
  }

  if (endPlan) {
    pushLinear(spans, cursor, endPlan.left.start)
    spans.push(endPlan.left)
  } else {
    pushLinear(spans, cursor, points.at(-1)!)
  }
  return spans
}

function buildBoundaryCorner(project: ActualRouteProject, segment: Segment, line: Line, points: AarcLinePathPoint[], side: 'start' | 'end', resolvedLineId: string): CornerPlan | null {
  const adjacent = findAdjacentSourceSegment(project, segment, side)
  if (!adjacent) return null
  const adjacentPoints = getAarcSegmentPoints(project, adjacent, resolvedLineId)
  if (adjacentPoints.length < 2) return null
  if (side === 'start') {
    if (adjacent.toStationId !== segment.fromStationId) return null
    return buildCornerPlan(project, line, adjacentPoints.at(-2)!, points[0], points[1])
  }
  if (adjacent.fromStationId !== segment.toStationId) return null
  return buildCornerPlan(project, line, points.at(-2)!, points.at(-1)!, adjacentPoints[1])
}

function getAarcSegmentPoints(project: ActualRouteProject, segment: Segment, resolvedLineId: string): AarcLinePathPoint[] {
  const from = getStationAnchorForLine(project, segment.fromStationId, resolvedLineId)
  const to = getStationAnchorForLine(project, segment.toStationId, resolvedLineId)
  if (!from || !to) return []
  return [
    { x: from.x, y: from.y, ...(getEndpointFree(project, segment, 'from') ? { free: true } : {}) },
    ...segment.waypoints.map(point => ({ x: point.x, y: point.y, ...(point.free === true ? { free: true } : {}) })),
    { x: to.x, y: to.y, ...(getEndpointFree(project, segment, 'to') ? { free: true } : {}) },
  ]
}

function getEndpointFree(project: ActualRouteProject, segment: Segment, side: 'from' | 'to') {
  const ids = segment.source?.pointIds
  const pointId = ids?.length ? (side === 'from' ? ids[0] : ids.at(-1)) : undefined
  if (pointId !== undefined) {
    const sourceValue = getRawAarcPointFree(project, pointId)
    if (sourceValue !== undefined) return sourceValue
  }
  const stationId = side === 'from' ? segment.fromStationId : segment.toStationId
  return project.stations.find(station => station.id === stationId)?.free === true
}

function getRawAarcPointFree(project: ActualRouteProject, pointId: number): boolean | undefined {
  const rawPoints = (project.aarc?.raw as { points?: unknown } | undefined)?.points
  if (!Array.isArray(rawPoints)) return undefined
  const raw = rawPoints.find(value => value && typeof value === 'object' && finiteId((value as { id?: unknown }).id) === pointId) as { free?: unknown } | undefined
  return raw ? raw.free === true : undefined
}

function findAdjacentSourceSegment(project: ActualRouteProject, segment: Segment, side: 'start' | 'end'): Segment | null {
  const sourceLineId = segment.source?.sourceLineId ?? segment.source?.lineId
  if (sourceLineId === undefined) return null
  const stationId = side === 'start' ? segment.fromStationId : segment.toStationId
  const currentIndex = sourceSegmentIndex(segment)
  const candidates = project.geometry.segments.filter(candidate => {
    if (candidate.id === segment.id || candidate.source?.format !== 'aarc') return false
    const candidateLineId = candidate.source?.sourceLineId ?? candidate.source?.lineId
    if (String(candidateLineId) !== String(sourceLineId)) return false
    return side === 'start' ? candidate.toStationId === stationId : candidate.fromStationId === stationId
  })
  if (!candidates.length) return null

  if (currentIndex !== null) {
    const expected = side === 'start' ? currentIndex - 1 : currentIndex + 1
    const exact = candidates.find(candidate => sourceSegmentIndex(candidate) === expected)
    if (exact) return exact
    if (isSourceLineRing(project, sourceLineId)) {
      const indexed = candidates.map(candidate => ({ candidate, index: sourceSegmentIndex(candidate) })).filter((value): value is { candidate: Segment; index: number } => value.index !== null)
      if (indexed.length) return indexed.sort((a, b) => side === 'start' ? b.index - a.index : a.index - b.index)[0].candidate
    }
  }
  return candidates.length === 1 ? candidates[0] : null
}

function sourceSegmentIndex(segment: Segment): number | null {
  const value = segment.source?.raw?.sourceSegmentIndex
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function isSourceLineRing(project: ActualRouteProject, sourceLineId: number | string) {
  const rawLines = (project.aarc?.raw as { lines?: unknown } | undefined)?.lines
  if (!Array.isArray(rawLines)) return false
  const line = rawLines.find(value => value && typeof value === 'object' && String((value as { id?: unknown }).id) === String(sourceLineId)) as { pts?: unknown } | undefined
  if (!line || !Array.isArray(line.pts) || line.pts.length < 3) return false
  return String(line.pts[0]) === String(line.pts.at(-1))
}

function buildCornerPlan(project: ActualRouteProject, line: Line, previous: AarcLinePathPoint, current: AarcLinePathPoint, next: AarcLinePathPoint): CornerPlan | null {
  const incomingRaw = subtract(current, previous)
  const outgoingRaw = subtract(next, current)
  const incomingLength = magnitude(incomingRaw), outgoingLength = magnitude(outgoingRaw)
  if (incomingLength < EPS || outgoingLength < EPS) return null

  const free = previous.free === true || current.free === true || next.free === true
  const incoming = free ? unit(incomingRaw) : unit8(incomingRaw)
  const outgoing = free ? unit(outgoingRaw) : unit8(outgoingRaw)
  const cross = cross2(incoming, outgoing)
  if (Math.abs(cross) < EPS) return null
  const dot = clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1)
  const deflection = Math.acos(dot)
  if (deflection < EPS || Math.PI - deflection < EPS) return null

  let trim: number
  if (free) {
    const theta = Math.atan2(Math.abs(cross), -dot)
    const radius = getTurnRadius(project, line, theta)
    const tanHalf = Math.tan(theta / 2)
    trim = Math.min(tanHalf > EPS ? radius / tanHalf : 0, incomingLength / 2, outgoingLength / 2)
  } else {
    const relation = wayRel(incomingRaw, outgoingRaw)
    if (relation === 'parallel') return null
    trim = Math.min(getTurnRadius(project, line, relation), incomingLength / 2, outgoingLength / 2)
  }
  if (!Number.isFinite(trim) || trim < EPS) return null

  const entry = { x: current.x - incoming.x * trim, y: current.y - incoming.y * trim }
  const exit = { x: current.x + outgoing.x * trim, y: current.y + outgoing.y * trim }
  const tanDeflectionHalf = Math.tan(deflection / 2)
  if (Math.abs(tanDeflectionHalf) < EPS) return null
  const actualRadius = trim / tanDeflectionHalf
  const handle = (4 / 3) * actualRadius * Math.tan(deflection / 4)
  const full: AarcLinePathSpan = {
    start: entry,
    control1: { x: entry.x + incoming.x * handle, y: entry.y + incoming.y * handle },
    control2: { x: exit.x - outgoing.x * handle, y: exit.y - outgoing.y * handle },
    end: exit,
    linear: false,
  }
  const [left, right] = splitCubic(full, .5)
  return { full, left, right }
}

function getTurnRadius(project: ActualRouteProject, line: Line, relation: WayRel | number) {
  const config = project.aarc?.config ?? {}
  const sourceRatio = finiteNumber(line.source?.sourceWidthRatio)
  const widthRatio = sourceRatio !== undefined && sourceRatio !== 0 ? sourceRatio : 1
  const lineTurnAreaRadius = finiteNumber(config.lineTurnAreaRadius) ?? 30
  const lineWidth = finiteNumber(config.lineWidth) ?? 14
  // AARC common lines: base *= line.width, then default inner justification adds half body width.
  let radius = Math.max(0, lineTurnAreaRadius * widthRatio + lineWidth * widthRatio / 2)
  if (typeof relation === 'number') {
    if (isZero(relation - Math.PI / 4)) radius /= TURN_45_RATIO
    else if (isZero(relation - 3 * Math.PI / 4)) radius *= TURN_45_RATIO
  } else if (relation === '45') radius /= TURN_45_RATIO
  else if (relation === '135') radius *= TURN_45_RATIO
  return radius
}

function wayRel(a: AarcLinePathPoint, b: AarcLinePathPoint): WayRel {
  const aw = signWay(a), bw = signWay(b)
  if (isZero(cross2(aw, bw))) return 'parallel'
  const dot = aw.x * bw.x + aw.y * bw.y
  if (isZero(dot)) return '90'
  return dot > 0 ? '45' : '135'
}

function splitCubic(span: AarcLinePathSpan, t: number): [AarcLinePathSpan, AarcLinePathSpan] {
  const ab = lerp(span.start, span.control1, t), bc = lerp(span.control1, span.control2, t), cd = lerp(span.control2, span.end, t)
  const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), middle = lerp(abc, bcd, t)
  return [
    { start: span.start, control1: ab, control2: abc, end: middle, linear: false },
    { start: middle, control1: bcd, control2: cd, end: span.end, linear: false },
  ]
}

function pushLinear(spans: AarcLinePathSpan[], start: AarcLinePathPoint, end: AarcLinePathPoint) {
  if (distance(start, end) <= EPS) return
  spans.push({ start, end, control1: start, control2: end, linear: true })
}

function finiteId(value: unknown): number | null { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) ? number : null }
function finiteNumber(value: unknown): number | undefined { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) ? number : undefined }
function isZero(value: number) { return Math.abs(value) < EPS }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function subtract(a: AarcLinePathPoint, b: AarcLinePathPoint) { return { x: a.x - b.x, y: a.y - b.y } }
function magnitude(value: AarcLinePathPoint) { return Math.hypot(value.x, value.y) }
function unit(value: AarcLinePathPoint): AarcLinePathPoint { const length = magnitude(value) || 1; return { x: value.x / length, y: value.y / length } }
function signWay(value: AarcLinePathPoint): AarcLinePathPoint { return { x: isZero(value.x) ? 0 : value.x > 0 ? 1 : -1, y: isZero(value.y) ? 0 : value.y > 0 ? 1 : -1 } }
function unit8(value: AarcLinePathPoint): AarcLinePathPoint { return unit(signWay(value)) }
function cross2(a: AarcLinePathPoint, b: AarcLinePathPoint) { return a.x * b.y - a.y * b.x }
function distance(a: AarcLinePathPoint, b: AarcLinePathPoint) { return Math.hypot(b.x - a.x, b.y - a.y) }
function lerp(a: AarcLinePathPoint, b: AarcLinePathPoint, t: number): AarcLinePathPoint { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
