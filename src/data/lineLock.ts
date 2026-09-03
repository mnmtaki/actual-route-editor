import type { ActualRouteProject } from './model'

/** Returns whether a Line currently owns a geometry lock. */
export function isLineLocked(project: ActualRouteProject, lineId: string | undefined): boolean {
  return Boolean(lineId && project.lines.find(line => line.id === lineId)?.locked)
}

/**
 * A station move changes every incident segment, so the station is guarded by
 * both its explicit line relations and the segment owners.  The latter keeps
 * malformed/legacy projects safe even when a relation is missing.
 */
export function getStationGeometryLineIds(project: ActualRouteProject, stationId: string): string[] {
  const ids = new Set<string>()
  project.stationLineRelations.forEach(relation => {
    if (relation.stationId === stationId) ids.add(relation.lineId)
  })
  project.geometry.segments.forEach(segment => {
    if (segment.fromStationId === stationId || segment.toStationId === stationId) ids.add(segment.lineId)
  })
  return [...ids]
}

export function getLockedStationLineIds(project: ActualRouteProject, stationId: string): string[] {
  return getStationGeometryLineIds(project, stationId).filter(lineId => isLineLocked(project, lineId))
}

export function isStationGeometryLocked(project: ActualRouteProject, stationId: string): boolean {
  return getLockedStationLineIds(project, stationId).length > 0
}

export function isSegmentGeometryLocked(project: ActualRouteProject, segmentId: string): boolean {
  const segment = project.geometry.segments.find(item => item.id === segmentId)
  return Boolean(segment && isLineLocked(project, segment.lineId))
}

export function canEditLineGeometry(project: ActualRouteProject, lineId: string): boolean {
  return !isLineLocked(project, lineId)
}

export function canEditStationGeometry(project: ActualRouteProject, stationId: string): boolean {
  return !isStationGeometryLocked(project, stationId)
}

export function canEditSegmentGeometry(project: ActualRouteProject, segmentId: string): boolean {
  return !isSegmentGeometryLocked(project, segmentId)
}

export function lockedStationMessage(project: ActualRouteProject, stationId: string): string {
  const names = getLockedStationLineIds(project, stationId)
    .map(lineId => project.lines.find(line => line.id === lineId)?.name)
    .filter((name): name is string => Boolean(name))
  return names.length ? `该站点关联了已锁定的 ${names.join('、')}` : '该站点关联了已锁定线路'
}
