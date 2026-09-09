import type { ActualRouteProject, Line } from '../data/model'
import { getStationAnchorForLine } from '../data/stationAnchor'
import { getStationLineTangent } from './tangent'

const PARALLEL_TOLERANCE_DEGREES = 15
const GEOMETRY_EPSILON = 1e-7
const NORMAL_DOMINANCE_RATIO = Math.tan(PARALLEL_TOLERANCE_DEGREES * Math.PI / 180)

export interface TransferSpatialOrderAnalysis {
  sortable: boolean
  order: number[]
  commonTangentDegrees?: number
  tangentSpread?: number
  normalSpread?: number
}

interface TransferSpatialCandidate {
  index: number
  anchor: { x: number; y: number }
  tangentDegrees: number
  normalProjection: number
}

/**
 * Decide whether a transfer is a parallel, side-by-side interchange and,
 * only then, return a stable screen-space order for its dots.
 *
 * The input array is never mutated.  A non-sortable transfer keeps its
 * existing relation/line order exactly as provided.
 */
export function analyzeTransferSpatialOrder(project: ActualRouteProject, stationId: string, lines: Line[]): TransferSpatialOrderAnalysis {
  const order = lines.map((_, index) => index)
  if (lines.length < 2 || !project.stations.some(station => station.id === stationId)) return { sortable: false, order }

  const candidates: TransferSpatialCandidate[] = []
  for (const [index, line] of lines.entries()) {
    const hasLocalGeometry = project.geometry.segments.some(segment =>
      segment.lineId === line.id && (segment.fromStationId === stationId || segment.toStationId === stationId),
    )
    const anchor = getStationAnchorForLine(project, stationId, line.id)
    if (!hasLocalGeometry || !anchor) return { sortable: false, order }
    candidates.push({ index, anchor, tangentDegrees: getStationLineTangent(project, stationId, line.id), normalProjection: 0 })
  }

  const referenceDegrees = candidates[0].tangentDegrees
  const unwrapped = candidates.map(candidate => unwrapAxisDelta(candidate.tangentDegrees - referenceDegrees))
  const minDelta = Math.min(...unwrapped), maxDelta = Math.max(...unwrapped)
  const tangentSpread = maxDelta - minDelta
  if (tangentSpread > PARALLEL_TOLERANCE_DEGREES * 2 + GEOMETRY_EPSILON) {
    return { sortable: false, order, tangentSpread }
  }
  const commonTangentDegrees = normalizeAxisDegrees(referenceDegrees + (minDelta + maxDelta) / 2)
  const tangent = { x: Math.cos(commonTangentDegrees * Math.PI / 180), y: Math.sin(commonTangentDegrees * Math.PI / 180) }
  const normal = stableScreenNormal(tangent)
  const origin = candidates[0].anchor
  for (const candidate of candidates) {
    const dx = candidate.anchor.x - origin.x, dy = candidate.anchor.y - origin.y
    candidate.normalProjection = dx * normal.x + dy * normal.y
  }
  const normalValues = candidates.map(candidate => candidate.normalProjection)
  const normalSpread = Math.max(...normalValues) - Math.min(...normalValues)
  if (normalSpread <= GEOMETRY_EPSILON) {
    return { sortable: false, order, commonTangentDegrees, tangentSpread, normalSpread }
  }
  const tangentValues = candidates.map(candidate => {
    const dx = candidate.anchor.x - origin.x, dy = candidate.anchor.y - origin.y
    return dx * tangent.x + dy * tangent.y
  })
  const tangentAnchorSpread = Math.max(...tangentValues) - Math.min(...tangentValues)
  if (tangentAnchorSpread > normalSpread * NORMAL_DOMINANCE_RATIO + GEOMETRY_EPSILON) {
    return { sortable: false, order, commonTangentDegrees, tangentSpread, normalSpread }
  }
  const sorted = [...candidates].sort((left, right) => left.normalProjection - right.normalProjection || left.index - right.index)
  return { sortable: true, order: sorted.map(candidate => candidate.index), commonTangentDegrees, tangentSpread, normalSpread }
}

export function sortTransferLinesForSpatialOrder(project: ActualRouteProject, stationId: string, lines: Line[]): Line[] {
  const analysis = analyzeTransferSpatialOrder(project, stationId, lines)
  return analysis.sortable ? analysis.order.map(index => lines[index]) : lines
}

function unwrapAxisDelta(degrees: number): number {
  let value = degrees % 180
  if (value > 90) value -= 180
  if (value < -90) value += 180
  return value
}

function normalizeAxisDegrees(degrees: number): number {
  let value = degrees % 180
  if (value < 0) value += 180
  return value
}

function stableScreenNormal(tangent: { x: number; y: number }): { x: number; y: number } {
  let normal = { x: -tangent.y, y: tangent.x }
  if (normal.y < -GEOMETRY_EPSILON || (Math.abs(normal.y) <= GEOMETRY_EPSILON && normal.x < 0)) normal = { x: -normal.x, y: -normal.y }
  return normal
}
