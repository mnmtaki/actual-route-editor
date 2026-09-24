import type { ActualRouteProject, Line, Segment } from '../data/model'
import { getStationAnchorForLine } from '../data/stationAnchor'

export interface AarcLinePathPoint { x: number; y: number; free?: boolean }
export interface AarcLinePathSpan { start: AarcLinePathPoint; control1: AarcLinePathPoint; control2: AarcLinePathPoint; end: AarcLinePathPoint; linear: boolean }

type RoundedWayRel = '45' | '90'
type CornerPlan = { full: AarcLinePathSpan }

const EPS = 1e-4
const TURN_45_RATIO = 2.4142135 * .618

/**
 * Rebuild an imported AARC transit segment with AARC's own corner semantics.
 * Rounded corners apply only to interior control points. Stations are explicit
 * Segment boundaries and are always reached exactly, so a station placed on a
 * bend stays a sharp boundary instead of borrowing a cross-Segment curve.
 *
 * Returns undefined for native AR segments so their existing modes stay intact.
 */
export function getAarcImportedSegmentPathSpans(project: ActualRouteProject, segment: Segment, resolvedLineId = segment.lineId): AarcLinePathSpan[] | undefined {
  if (segment.source?.format !== 'aarc') return undefined
  const line = project.lines.find(item => item.id === resolvedLineId) ?? project.lines.find(item => item.id === segment.lineId)
  if (!line || line.source?.format !== 'aarc') return undefined
  const points = getAarcSegmentPoints(project, segment, resolvedLineId)
  if (points.length < 2) return []

  const spans: AarcLinePathSpan[] = []
  let cursor = points[0]

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const plan = buildCornerPlan(project, line, points[index - 1], current, points[index + 1])
    if (!plan) {
      pushLinear(spans, cursor, current)
      cursor = current
      continue
    }
    pushLinear(spans, cursor, plan.full.start)
    spans.push(plan.full)
    cursor = plan.full.end
  }

  pushLinear(spans, cursor, points.at(-1)!)
  return spans
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

function buildCornerPlan(project: ActualRouteProject, line: Line, previous: AarcLinePathPoint, current: AarcLinePathPoint, next: AarcLinePathPoint): CornerPlan | null {
  const incomingRaw = subtract(current, previous)
  const outgoingRaw = subtract(next, current)
  const incomingLength = magnitude(incomingRaw), outgoingLength = magnitude(outgoingRaw)
  if (incomingLength < EPS || outgoingLength < EPS) return null

  const free = previous.free === true || current.free === true || next.free === true
  const relation = free ? null : roundedCornerRelation(incomingRaw, outgoingRaw)
  if (!free && !relation) return null

  const incoming = free ? unit(incomingRaw) : unit8(incomingRaw)
  const outgoing = free ? unit(outgoingRaw) : unit8(outgoingRaw)
  const cross = cross2(incoming, outgoing)
  const dot = clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1)
  const deflection = Math.acos(dot)
  if (deflection < EPS || Math.PI - deflection < EPS) return null

  let trim: number
  if (free) {
    // AARC free points bypass formalize but still receive a real-angle fillet.
    // theta is the interior angle, matching AARC lineCvsWorker.linkPts().
    const theta = Math.atan2(Math.abs(cross), -dot)
    const radius = getTurnRadius(project, line, theta)
    const tanHalf = Math.tan(theta / 2)
    trim = Math.min(tanHalf > EPS ? radius / tanHalf : 0, incomingLength / 2, outgoingLength / 2)
  } else {
    trim = Math.min(getTurnRadius(project, line, relation!), incomingLength / 2, outgoingLength / 2)
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
  return { full }
}

function getTurnRadius(project: ActualRouteProject, line: Line, relation: RoundedWayRel | number) {
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
  return radius
}

function roundedCornerRelation(a: AarcLinePathPoint, b: AarcLinePathPoint): RoundedWayRel | null {
  const aw = octilinearWay(a), bw = octilinearWay(b)
  if (!aw || !bw || isZero(cross2(aw, bw))) return null
  const dot = aw.x * bw.x + aw.y * bw.y
  if (isZero(dot)) return '90'
  return dot > 0 ? '45' : null
}

function octilinearWay(value: AarcLinePathPoint): AarcLinePathPoint | null {
  const x = Math.abs(value.x), y = Math.abs(value.y)
  if (x < EPS && y < EPS) return null
  const legal = x < EPS || y < EPS || Math.abs(x - y) < EPS
  return legal ? signWay(value) : null
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