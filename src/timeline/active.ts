import type { ActualRouteProject, ISODate, Line, StationLineRelation } from '../data/model'
import { collapseLinesByServiceFamily } from '../data/lineIdentity'
import { getCompoundStationRelations } from '../data/compoundStation'

export function isActiveAt(openedAt: ISODate | undefined, closedAt: ISODate | undefined, time: string) {
  return (!openedAt || openedAt <= time) && (!closedAt || time < closedAt)
}
function compareRelations(project: ActualRouteProject, stationId: string, a: string, b: string) {
  const relation = (lineId: string): StationLineRelation | undefined => getCompoundStationRelations(project, stationId).find(item => item.lineId === lineId)
  const ra = relation(a), rb = relation(b)
  const dateOrder = (ra?.openedAt ?? '0000-00-00').localeCompare(rb?.openedAt ?? '0000-00-00')
  return dateOrder || ((project.lines.find(line => line.id === a)?.lineOrder ?? 0) - (project.lines.find(line => line.id === b)?.lineOrder ?? 0))
}
export function isStationHistoricallyActive(project: ActualRouteProject, stationId: string, time: string) {
  return getCompoundStationRelations(project, stationId).some(relation => isActiveAt(relation.openedAt, relation.closedAt, time) && Boolean(project.lines.find(line => line.id === relation.lineId && line.visible && isActiveAt(line.openedAt, line.closedAt, time))))
}
export function getActiveLinesAtStation(project: ActualRouteProject, stationId: string, time: string): Line[] {
  const relationByLine = new Map<string, StationLineRelation>()
  for (const relation of getCompoundStationRelations(project, stationId)) if (!relationByLine.has(relation.lineId) && isActiveAt(relation.openedAt, relation.closedAt, time)) relationByLine.set(relation.lineId, relation)
  return [...relationByLine.values()]
    .map(relation => project.lines.find(line => line.id === relation.lineId))
    .filter((line): line is Line => Boolean(line && line.visible && isActiveAt(line.openedAt, line.closedAt, time)))
    .sort((a, b) => compareRelations(project, stationId, a.id, b.id))
}
export function getPassengerLinesAtStation(project: ActualRouteProject, stationId: string, time: string): Line[] {
  return collapseLinesByServiceFamily(project, getActiveLinesAtStation(project, stationId, time))
}
export function getPassengerVisibleRelationIds(project: ActualRouteProject, stationId: string, time: string, lineIds?: string[]): string[] {
  const ids = lineIds ?? getActiveLinesAtStation(project, stationId, time).map(line => line.id)
  const representatives = new Set(collapseLinesByServiceFamily(project, ids.map(id => project.lines.find(line => line.id === id)).filter((line): line is Line => Boolean(line))).map(line => line.id))
  return getCompoundStationRelations(project, stationId)
    .filter(relation => representatives.has(relation.lineId) && isActiveAt(relation.openedAt, relation.closedAt, time))
    .map(relation => relation.id)
}
export function getFirstLineAtStation(project: ActualRouteProject, stationId: string) {
  const ids = getCompoundStationRelations(project, stationId).map(relation => relation.lineId)
  return project.lines.filter(line => ids.includes(line.id)).sort((a, b) => compareRelations(project, stationId, a.id, b.id))[0]
}
export function getOrientationAnchorLine(project: ActualRouteProject, stationId: string, time: string) {
  const station = project.stations.find(item => item.id === stationId)
  const anchor = station?.orientationAnchorLineId ? project.lines.find(line => line.id === station.orientationAnchorLineId) : getFirstLineAtStation(project, stationId)
  if (anchor && getCompoundStationRelations(project, stationId).some(relation => relation.lineId === anchor.id)) return anchor
  return getActiveLinesAtStation(project, stationId, time)[0]
}
export function getActiveNetworkAtTime(project: ActualRouteProject, time: string) {
  const lines = project.lines.filter(line => line.visible && isActiveAt(line.openedAt, line.closedAt, time))
  const lineIds = new Set(lines.map(line => line.id))
  const relations = project.stationLineRelations.filter(relation => lineIds.has(relation.lineId) && isActiveAt(relation.openedAt, relation.closedAt, time))
  const stationIds = new Set(relations.map(relation => relation.stationId))
  const stations = project.stations.filter(station => stationIds.has(station.id))
  const segments = project.geometry.segments.filter(segment => lineIds.has(segment.lineId) && isActiveAt(segment.openedAt, segment.closedAt, time))
  return { lines, stations, relations, segments }
}