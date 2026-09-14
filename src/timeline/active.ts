import type { ActualRouteProject, ISODate, Line, Segment, StationLineRelation } from '../data/model'
import { collapseLinesByServiceFamily, getRootLineId } from '../data/lineIdentity'
import { getCompoundStationCanonical, getCompoundStationRelations } from '../data/compoundStation'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'
export { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'

/** Legacy single-interval helper retained for import/tests. New runtime visibility uses operation-history aware helpers below. */
export function isActiveAt(openedAt: ISODate | undefined, closedAt: ISODate | undefined, time: string) {
  return (!openedAt || openedAt <= time) && (!closedAt || time < closedAt)
}
function compareRelations(project: ActualRouteProject, stationId: string, a: string, b: string) {
  const relation = (lineId: string): StationLineRelation | undefined => getCompoundStationRelations(project, stationId).find(item => item.lineId === lineId)
  const ra = relation(a), rb = relation(b)
  const dateOrder = (ra?.openedAt ?? '0000-00-00').localeCompare(rb?.openedAt ?? '0000-00-00')
  return dateOrder || ((project.lines.find(line => line.id === a)?.lineOrder ?? 0) - (project.lines.find(line => line.id === b)?.lineOrder ?? 0))
}

/**
 * Effective passenger service at one Station×Line relation.
 *
 * Hierarchy is intentionally asymmetric:
 * - a relation-level closure may suppress an otherwise open line/segment;
 * - a relation-level opening can never resurrect a closed parent line or a station
 *   whose every incident segment on that line is closed.
 * A later network operation event must reopen the parent service first.
 */
export function isStationLineServiceActiveAt(project: ActualRouteProject, relation: StationLineRelation, time: string) {
  const line = project.lines.find(item => item.id === relation.lineId)
  if (!line?.visible || !isLineOperationalAt(line, time) || !isRelationOperationalAt(relation, time)) return false
  return project.geometry.segments.some(segment => {
    if (segment.fromStationId !== relation.stationId && segment.toStationId !== relation.stationId) return false
    if (!isSegmentOperationalAt(segment, time)) return false
    return resolveSegmentLineAt(segment, time) === relation.lineId
  })
}

export function isStationHistoricallyActive(project: ActualRouteProject, stationId: string, time: string) {
  return getCompoundStationRelations(project, stationId).some(relation => isStationLineServiceActiveAt(project, relation, time))
}
export function getActiveLinesAtStation(project: ActualRouteProject, stationId: string, time: string): Line[] {
  const relationByLine = new Map<string, StationLineRelation>()
  for (const relation of getCompoundStationRelations(project, stationId)) if (!relationByLine.has(relation.lineId) && isStationLineServiceActiveAt(project, relation, time)) relationByLine.set(relation.lineId, relation)
  return [...relationByLine.values()]
    .map(relation => project.lines.find(line => line.id === relation.lineId))
    .filter((line): line is Line => Boolean(line))
    .sort((a, b) => compareRelations(project, stationId, a.id, b.id))
}
export function getPassengerLinesAtStation(project: ActualRouteProject, stationId: string, time: string): Line[] {
  return collapseLinesByServiceFamily(project, getActiveLinesAtStation(project, stationId, time))
}
export function getPassengerVisibleRelationIds(project: ActualRouteProject, stationId: string, time: string, lineIds?: string[]): string[] {
  const ids = lineIds ?? getActiveLinesAtStation(project, stationId, time).map(line => line.id)
  const representativeFamilies = new Set(ids.map(id => project.lines.find(line => line.id === id)).filter((line): line is Line => Boolean(line)).map(line => getRootLineId(project, line)))
  return getCompoundStationRelations(project, stationId)
    .filter(relation => {
      const relationLine = project.lines.find(line => line.id === relation.lineId)
      return Boolean(relationLine && representativeFamilies.has(getRootLineId(project, relationLine)) && isStationLineServiceActiveAt(project, relation, time))
    })
    .map(relation => relation.id)
}
export function getFirstLineAtStation(project: ActualRouteProject, stationId: string) {
  const ids = getCompoundStationRelations(project, stationId).map(relation => relation.lineId)
  return project.lines.filter(line => ids.includes(line.id)).sort((a, b) => compareRelations(project, stationId, a.id, b.id))[0]
}
export function getOrientationAnchorLine(project: ActualRouteProject, stationId: string, time: string) {
  const station = project.stations.find(item => item.id === stationId)
  const anchor = station?.orientationAnchorLineId ? project.lines.find(line => line.id === station.orientationAnchorLineId) : getFirstLineAtStation(project, stationId)
  if (anchor && getCompoundStationRelations(project, stationId).some(relation => relation.lineId === anchor.id && isStationLineServiceActiveAt(project, relation, time))) return anchor
  return getActiveLinesAtStation(project, stationId, time)[0]
}
export type ActiveSegment = Segment & { effectiveLineIdAtCurrentDate: string }
export function getActiveNetworkAtTime(project: ActualRouteProject, time: string) {
  const lines = project.lines.filter(line => line.visible && isLineOperationalAt(line, time))
  const lineIds = new Set(lines.map(line => line.id))
  const relations = project.stationLineRelations.filter(relation => lineIds.has(relation.lineId) && isStationLineServiceActiveAt(project, relation, time))
  const canonicalIds = new Set<string>()
  for (const relation of relations) canonicalIds.add(getCompoundStationCanonical(project, relation.stationId)?.id ?? relation.stationId)
  const stations = project.stations.filter(station => canonicalIds.has(station.id))
  const segments = project.geometry.segments.flatMap(segment => {
    if (!isSegmentOperationalAt(segment, time)) return []
    const effectiveLineIdAtCurrentDate = resolveSegmentLineAt(segment, time)
    if (!lineIds.has(effectiveLineIdAtCurrentDate)) return []
    return [{ ...segment, lineId: effectiveLineIdAtCurrentDate, effectiveLineIdAtCurrentDate }]
  })
  return { lines, stations, relations, segments }
}
