import type { ActualRouteProject, StationLineRelation } from './model'

/** A per-line station occurrence position.  Most stations use their shared
 * logical coordinates; AARC interchanges may retain a source position for a
 * particular line without duplicating the Station entity. */
export interface StationAnchor { x: number; y: number }

export const STATION_ANCHOR_EPSILON = 1e-7

export function isFiniteStationAnchor(value: unknown): value is StationAnchor {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { x?: unknown; y?: unknown }
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number' && Number.isFinite(candidate.y)
}

export function normalizeStationAnchor(value: unknown, station?: { x: number; y: number }): StationAnchor | undefined {
  if (!isFiniteStationAnchor(value)) return undefined
  const anchor = { x: value.x, y: value.y }
  if (station && Math.hypot(anchor.x - station.x, anchor.y - station.y) <= STATION_ANCHOR_EPSILON) return undefined
  return anchor
}

export function getStationRelation(project: ActualRouteProject, stationId: string, lineId?: string): StationLineRelation | undefined {
  return project.stationLineRelations.find(relation => relation.stationId === stationId && (lineId === undefined || relation.lineId === lineId))
}

export function getStationAnchorForLine(project: ActualRouteProject, stationId: string, lineId?: string): StationAnchor | undefined {
  const station = project.stations.find(item => item.id === stationId)
  if (!station) return undefined
  const relation = getStationRelation(project, stationId, lineId)
  return normalizeStationAnchor(relation?.anchor, station) ?? { x: station.x, y: station.y }
}

/** Move a logical station and every existing per-line occurrence together. */
export function translateStationWithAnchors(project: ActualRouteProject, stationId: string, dx: number, dy: number): void {
  const station = project.stations.find(item => item.id === stationId)
  if (!station || !Number.isFinite(dx) || !Number.isFinite(dy)) return
  station.x += dx
  station.y += dy
  for (const relation of project.stationLineRelations) {
    if (relation.stationId !== stationId || !relation.anchor) continue
    relation.anchor = { x: relation.anchor.x + dx, y: relation.anchor.y + dy }
  }
}
