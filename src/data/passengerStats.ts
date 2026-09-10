import type { ActualRouteProject } from './model'
import { getPassengerStationIdentity } from './compoundStation'

/** Count unique passenger-facing stations across all concrete relations. */
export function getPassengerStationCount(project: ActualRouteProject): number {
  return new Set(project.stationLineRelations.map(relation => getPassengerStationIdentity(project, relation.stationId))).size
}

/** Count unique passenger-facing stations for one concrete line scope. */
export function getPassengerStationCountForLine(project: ActualRouteProject, lineId: string): number {
  return new Set(
    project.stationLineRelations
      .filter(relation => relation.lineId === lineId)
      .map(relation => getPassengerStationIdentity(project, relation.stationId)),
  ).size
}