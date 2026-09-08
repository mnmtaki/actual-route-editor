import type { ActualRouteProject } from '../data/model'
import { getStationAnchorForLine } from '../data/stationAnchor'
import { sampleSegmentNearStation } from './path'
import { getOrientationAnchorLine, isActiveAt } from '../timeline/active'

const ANCHOR_EPSILON = 1e-7

export function getStationLineTangent(project: ActualRouteProject, stationId: string, lineId: string): number {
  const station = project.stations.find((item) => item.id === stationId)
  if (!station) return 0
  const connected = project.geometry.segments.filter(
    (segment) => segment.lineId === lineId && (segment.fromStationId === stationId || segment.toStationId === stationId),
  )
  const samples = connected
    .map((segment) => sampleSegmentNearStation(project, segment, stationId))
    .filter((point): point is { x: number; y: number } => Boolean(point))
  if (!samples.length) return 0
  let vector: { x: number; y: number }
  if (samples.length >= 2) {
    vector = { x: samples[1].x - samples[0].x, y: samples[1].y - samples[0].y }
  } else {
    vector = { x: samples[0].x - station.x, y: samples[0].y - station.y }
  }
  return canonicalAxisAngle(Math.atan2(vector.y, vector.x) * 180 / Math.PI)
}

export interface TransferMarkerLayout {
  rotation: number
  centerX: number
  centerY: number
  anchorSpan: number
}

interface ResolvedAnchor { lineId: string; x: number; y: number }

/**
 * Resolve transfer orientation from the spatial facts of the currently
 * visible line relations.  Relation order and segment tangents are used only
 * for the single/coincident-anchor fallback.
 */
export function getTransferMarkerLayout(project: ActualRouteProject, stationId: string, time: string, visibleRelationIds?: string[], endPadding = 0): TransferMarkerLayout {
  const station = project.stations.find(item => item.id === stationId)
  if (!station) return { rotation: 0, centerX: 0, centerY: 0, anchorSpan: 0 }
  const visibleIdSet = visibleRelationIds ? new Set(visibleRelationIds) : null
  const relations = project.stationLineRelations
    .filter(relation => relation.stationId === stationId)
    .filter(relation => visibleIdSet ? visibleIdSet.has(relation.id) : isActiveAt(relation.openedAt, relation.closedAt, time))
    .filter(relation => {
      const line = project.lines.find(item => item.id === relation.lineId)
      return Boolean(line && line.visible && isActiveAt(line.openedAt, line.closedAt, time))
    })
  const anchors: ResolvedAnchor[] = relations
    .map(relation => {
      const point = getStationAnchorForLine(project, stationId, relation.lineId)
      return point ? { lineId: relation.lineId, x: point.x, y: point.y } : null
    })
    .filter((point): point is ResolvedAnchor => Boolean(point))
    .filter((point, index, all) => all.findIndex(other => Math.abs(other.x - point.x) <= ANCHOR_EPSILON && Math.abs(other.y - point.y) <= ANCHOR_EPSILON) === index)
  if (anchors.length >= 2) {
    let bestA = anchors[0], bestB = anchors[1], bestDistance = squaredDistance(bestA, bestB), bestKey = pairKey(bestA, bestB)
    for (let first = 0; first < anchors.length; first += 1) for (let second = first + 1; second < anchors.length; second += 1) {
      const a = anchors[first], b = anchors[second], distance = squaredDistance(a, b), key = pairKey(a, b)
      if (distance > bestDistance + ANCHOR_EPSILON || (Math.abs(distance - bestDistance) <= ANCHOR_EPSILON && key < bestKey)) {
        bestA = a; bestB = b; bestDistance = distance; bestKey = key
      }
    }
    const anchorSpan = Math.sqrt(bestDistance)
    return {
      rotation: canonicalAxisAngle(Math.atan2(bestB.y - bestA.y, bestB.x - bestA.x) * 180 / Math.PI),
      centerX: (bestA.x + bestB.x) / 2,
      centerY: (bestA.y + bestB.y) / 2,
      anchorSpan: anchorSpan + Math.max(0, endPadding) * 2,
    }
  }
  const fallback = getTransferMarkerRotationFallback(project, stationId, time)
  return { rotation: fallback, centerX: station.x, centerY: station.y, anchorSpan: 0 }
}

export function getTransferMarkerRotation(project: ActualRouteProject, stationId: string, time: string, visibleRelationIds?: string[]): number {
  return getTransferMarkerLayout(project, stationId, time, visibleRelationIds).rotation
}

function getTransferMarkerRotationFallback(project: ActualRouteProject, stationId: string, time: string): number {
  const anchor = getOrientationAnchorLine(project, stationId, time)
  return anchor ? getStationLineTangent(project, stationId, anchor.id) : 0
}

function canonicalAxisAngle(degrees: number): number {
  let value = degrees % 180
  if (value < 0) value += 180
  return Math.abs(value) < ANCHOR_EPSILON || Math.abs(value - 180) < ANCHOR_EPSILON ? 0 : value
}
function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number { return (b.x - a.x) ** 2 + (b.y - a.y) ** 2 }
function pairKey(a: ResolvedAnchor, b: ResolvedAnchor): string {
  const values = [`${a.x.toFixed(7)},${a.y.toFixed(7)}`, `${b.x.toFixed(7)},${b.y.toFixed(7)}`].sort()
  return values.join('|')
}
