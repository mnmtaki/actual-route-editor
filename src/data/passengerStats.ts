import type { ActualRouteProject } from './model'
import { getPassengerStationIdentity } from './compoundStation'
import { isFakeLine } from './fakeLines'

function passengerRelations(project: ActualRouteProject) {
  const fakeIds = new Set(project.lines.filter(isFakeLine).map(line => line.id))
  return project.stationLineRelations.filter(relation => !fakeIds.has(relation.lineId))
}

/** Count unique passenger-facing stations across all concrete operating relations. */
export function getPassengerStationCount(project: ActualRouteProject): number {
  return new Set(passengerRelations(project).map(relation => getPassengerStationIdentity(project, relation.stationId))).size
}

/** Count unique passenger-facing stations for one concrete operating line scope. */
export function getPassengerStationCountForLine(project: ActualRouteProject, lineId: string): number {
  if (isFakeLine(project.lines.find(line => line.id === lineId))) return 0
  return new Set(
    passengerRelations(project)
      .filter(relation => relation.lineId === lineId)
      .map(relation => getPassengerStationIdentity(project, relation.stationId)),
  ).size
}
