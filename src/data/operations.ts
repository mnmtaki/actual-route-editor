import type { ActualRouteProject, ISODate, Line, Segment, Station, Waypoint } from './model'
import { uid } from './model'

export interface Point { x: number; y: number }

export interface NewLineInput {
  name: string
  color: string
  openedAt?: ISODate
}

export function createLine(project: ActualRouteProject, input: NewLineInput): { project: ActualRouteProject; lineId: string } {
  const next = structuredClone(project)
  const lineId = uid('line')
  next.lines.push({
    id: lineId,
    name: input.name.trim() || `新线路 ${next.lines.length + 1}`,
    color: input.color,
    stationSequence: [],
    lineOrder: next.lines.length,
    openedAt: input.openedAt || null,
    closedAt: null,
    visible: true,
    locked: false,
  })
  return { project: next, lineId }
}

export function appendStationToLine(project: ActualRouteProject, lineId: string, point: Point, fromStationId?: string | null): { project: ActualRouteProject; stationId: string } {
  const next = structuredClone(project)
  const line = requireLine(next, lineId)
  const stationId = uid('station')
  const openedAt = line.openedAt ?? next.timeline.currentDate ?? null
  const station: Station = {
    id: stationId,
    name: `新车站 ${next.stations.length + 1}`,
    x: point.x,
    y: point.y,
    labelOffsetX: 14,
    labelOffsetY: -14,
  }
  next.stations.push(station)
  addMembership(next, stationId, lineId, openedAt)
  const anchor = fromStationId ?? line.stationSequence.at(-1) ?? null
  line.stationSequence.push(stationId)
  if (anchor && anchor !== stationId) next.geometry.segments.push(makeSegment(line, anchor, stationId, openedAt))
  return { project: next, stationId }
}

export function connectExistingStation(project: ActualRouteProject, lineId: string, stationId: string, fromStationId?: string | null): ActualRouteProject {
  const next = structuredClone(project)
  const line = requireLine(next, lineId)
  if (!next.stations.some((station) => station.id === stationId)) return project
  const openedAt = line.openedAt ?? next.timeline.currentDate ?? null
  const anchor = fromStationId ?? line.stationSequence.at(-1) ?? null
  addMembership(next, stationId, lineId, openedAt)
  if (!line.stationSequence.includes(stationId)) line.stationSequence.push(stationId)
  if (anchor && anchor !== stationId && !hasSegment(next, lineId, anchor, stationId)) {
    next.geometry.segments.push(makeSegment(line, anchor, stationId, openedAt))
  }
  return next
}

export function addWaypointToSegment(project: ActualRouteProject, segmentId: string, point: Point): { project: ActualRouteProject; waypointId: string | null } {
  const next = structuredClone(project)
  const segment = next.geometry.segments.find((item) => item.id === segmentId)
  if (!segment) return { project, waypointId: null }
  const waypoint: Waypoint = { id: uid('waypoint'), x: point.x, y: point.y, type: 'smooth' }
  const insertAt = findWaypointInsertionIndex(next, segment, point)
  segment.waypoints.splice(insertAt, 0, waypoint)
  segment.mode = 'smooth'
  return { project: next, waypointId: waypoint.id }
}

export function insertStationIntoSegment(project: ActualRouteProject, segmentId: string, point: Point): { project: ActualRouteProject; stationId: string | null } {
  const next = structuredClone(project)
  const index = next.geometry.segments.findIndex((item) => item.id === segmentId)
  if (index < 0) return { project, stationId: null }
  const source = next.geometry.segments[index]
  const line = requireLine(next, source.lineId)
  const stationId = uid('station')
  const openedAt = source.openedAt ?? line.openedAt ?? next.timeline.currentDate ?? null
  next.stations.push({ id: stationId, name: `新车站 ${next.stations.length + 1}`, x: point.x, y: point.y, labelOffsetX: 14, labelOffsetY: -14 })
  addMembership(next, stationId, line.id, openedAt)
  const insertAfter = line.stationSequence.indexOf(source.fromStationId)
  if (insertAfter >= 0) line.stationSequence.splice(insertAfter + 1, 0, stationId)
  else line.stationSequence.push(stationId)
  const splitAt = findWaypointInsertionIndex(next, source, point)
  const before = source.waypoints.slice(0, splitAt)
  const after = source.waypoints.slice(splitAt)
  const first: Segment = { ...source, id: uid('segment'), toStationId: stationId, waypoints: before }
  const second: Segment = { ...source, id: uid('segment'), fromStationId: stationId, waypoints: after }
  next.geometry.segments.splice(index, 1, first, second)
  return { project: next, stationId }
}

export function deleteLineAndOrphans(project: ActualRouteProject, lineId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.lines = next.lines.filter((line) => line.id !== lineId)
  next.stationLineRelations = next.stationLineRelations.filter((relation) => relation.lineId !== lineId)
  next.geometry.segments = next.geometry.segments.filter((segment) => segment.lineId !== lineId)
  return pruneOrphanStations(next)
}

export function deleteStationConsistently(project: ActualRouteProject, stationId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.stations = next.stations.filter((station) => station.id !== stationId)
  next.stationLineRelations = next.stationLineRelations.filter((relation) => relation.stationId !== stationId)
  next.geometry.segments = next.geometry.segments.filter((segment) => segment.fromStationId !== stationId && segment.toStationId !== stationId)
  next.lines.forEach((line) => { line.stationSequence = line.stationSequence.filter((id) => id !== stationId) })
  return pruneOrphanStations(next)
}

export function pruneOrphanStations(project: ActualRouteProject): ActualRouteProject {
  const next = structuredClone(project)
  const memberIds = new Set(next.stationLineRelations.map((relation) => relation.stationId))
  next.stations = next.stations.filter((station) => memberIds.has(station.id))
  const stationIds = new Set(next.stations.map((station) => station.id))
  next.lines.forEach((line) => { line.stationSequence = line.stationSequence.filter((id) => stationIds.has(id)) })
  next.geometry.segments = next.geometry.segments.filter((segment) => stationIds.has(segment.fromStationId) && stationIds.has(segment.toStationId))
  return next
}

export function stationLineIds(project: ActualRouteProject, stationId: string): string[] {
  return project.stationLineRelations.filter((relation) => relation.stationId === stationId).map((relation) => relation.lineId)
}

function requireLine(project: ActualRouteProject, lineId: string): Line {
  const line = project.lines.find((item) => item.id === lineId)
  if (!line) throw new Error(`Line not found: ${lineId}`)
  return line
}

function addMembership(project: ActualRouteProject, stationId: string, lineId: string, openedAt: ISODate | undefined) {
  if (!project.stationLineRelations.some((relation) => relation.stationId === stationId && relation.lineId === lineId)) {
    project.stationLineRelations.push({ id: uid('relation'), stationId, lineId, openedAt: openedAt ?? null, closedAt: null })
  }
}

function makeSegment(line: Line, fromStationId: string, toStationId: string, openedAt: ISODate | undefined): Segment {
  return { id: uid('segment'), lineId: line.id, fromStationId, toStationId, mode: 'straight', waypoints: [], openedAt: openedAt ?? null, closedAt: null }
}

function hasSegment(project: ActualRouteProject, lineId: string, a: string, b: string): boolean {
  return project.geometry.segments.some((segment) => segment.lineId === lineId && ((segment.fromStationId === a && segment.toStationId === b) || (segment.fromStationId === b && segment.toStationId === a)))
}

function findWaypointInsertionIndex(project: ActualRouteProject, segment: Segment, point: Point): number {
  const from = project.stations.find((station) => station.id === segment.fromStationId)
  const to = project.stations.find((station) => station.id === segment.toStationId)
  if (!from || !to || !segment.waypoints.length) return 0
  const chain = [from, ...segment.waypoints, to]
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < chain.length - 1; index += 1) {
    const distance = distanceToSegment(point, chain[index], chain[index + 1])
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index }
  }
  return bestIndex
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}
