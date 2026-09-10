import type { ActualRouteProject, Station, StationLineRelation } from './model'

export function isPlaceholderStationName(name: unknown): boolean {
  return typeof name === 'string' && /^未命名站\s+\d+$/.test(name.trim())
}

export function getCompoundStationMembers(project: ActualRouteProject, stationOrId: Station | string): Station[] {
  const station = typeof stationOrId === 'string' ? project.stations.find(item => item.id === stationOrId) : stationOrId
  if (!station) return []
  const groupId = typeof station.compoundGroupId === 'string' ? station.compoundGroupId.trim() : ''
  if (!groupId) return [station]
  const members = project.stations.filter(item => typeof item.compoundGroupId === 'string' && item.compoundGroupId.trim() === groupId)
  return members.length ? members : [station]
}

export function getCompoundStationCanonical(project: ActualRouteProject, stationOrId: Station | string): Station | undefined {
  const members = getCompoundStationMembers(project, stationOrId)
  return [...members].sort((a, b) => {
    const aNamed = Boolean(a.name?.trim()) && !isPlaceholderStationName(a.name)
    const bNamed = Boolean(b.name?.trim()) && !isPlaceholderStationName(b.name)
    return Number(bNamed) - Number(aNamed) || project.stations.indexOf(a) - project.stations.indexOf(b) || a.id.localeCompare(b.id)
  })[0]
}

export function isCompoundStationCanonical(project: ActualRouteProject, stationOrId: Station | string): boolean {
  const station = typeof stationOrId === 'string' ? project.stations.find(item => item.id === stationOrId) : stationOrId
  const canonical = station ? getCompoundStationCanonical(project, station) : undefined
  return Boolean(station && canonical?.id === station.id)
}

export function getCompoundStationMemberIds(project: ActualRouteProject, stationOrId: Station | string): string[] {
  return getCompoundStationMembers(project, stationOrId).map(station => station.id)
}

export function getPassengerStationIdentity(project: ActualRouteProject, stationOrId: Station | string): string {
  const members = getCompoundStationMembers(project, stationOrId)
  const groupId = typeof members[0]?.compoundGroupId === 'string' ? members[0].compoundGroupId.trim() : ''
  return groupId && members.length > 1 ? `compound:${groupId}` : (members[0]?.id ?? String(stationOrId))
}

export function areStationsSamePassengerStation(project: ActualRouteProject, a: Station | string, b: Station | string): boolean {
  return getPassengerStationIdentity(project, a) === getPassengerStationIdentity(project, b)
}

export function getCompoundStationRelations(project: ActualRouteProject, stationOrId: Station | string, predicate?: (relation: StationLineRelation) => boolean): StationLineRelation[] {
  const memberIds = new Set(getCompoundStationMemberIds(project, stationOrId))
  return project.stationLineRelations.filter(relation => memberIds.has(relation.stationId) && (!predicate || predicate(relation)))
}

export function getAarcCompoundGroupId(pointIds: number[]): string {
  return `aarc-compound-${[...new Set(pointIds)].sort((a, b) => a - b).join('-')}`
}
