import type { ActualRouteProject, Segment } from './model'
import { worldUnitsToKilometers, worldUnitsToMeters } from './distance'
import { getSegmentCurveLength } from '../geometry/path'

export interface StationSpacing {
  lineId: string
  segmentId: string
  fromStationId: string
  toStationId: string
  distanceWorld: number
  distanceMeters: number
  distanceKilometers: number
}

type SegmentReference = Segment | string

/** Return the current physical centreline length of one Segment in world units. */
export function getSegmentDistanceWorld(project: ActualRouteProject, segment: SegmentReference): number {
  const resolved = resolveSegment(project, segment)
  if (!project.stations.some(station => station.id === resolved.fromStationId) || !project.stations.some(station => station.id === resolved.toStationId)) {
    throw new Error(`区间 ${resolved.id} 引用了不存在的车站`)
  }
  const length = getSegmentCurveLength(project, resolved)
  if (!Number.isFinite(length) || length < 0) throw new Error(`区间 ${resolved.id} 的几何长度无效`)
  return length
}

/** Return one Segment's centreline length in metres using the project's scale. */
export function getSegmentDistanceMeters(project: ActualRouteProject, segment: SegmentReference): number {
  return worldUnitsToMeters(getSegmentDistanceWorld(project, segment), project)
}

/** Return one Segment's centreline length in kilometres using the project's scale. */
export function getSegmentDistanceKilometers(project: ActualRouteProject, segment: SegmentReference): number {
  return worldUnitsToKilometers(getSegmentDistanceWorld(project, segment), project)
}

/**
 * Derive distances between adjacent stations in the line's stored order.
 * A closing pair is included only when the current topology is a closed ring:
 * every station has degree two and there is one current-line segment per station.
 */
export function getLineStationSpacings(project: ActualRouteProject, lineId: string): StationSpacing[] {
  const line = project.lines.find(item => item.id === lineId)
  if (!line) throw new Error(`未找到线路 ${lineId}`)
  const stationIds = line.stationSequence
  if (stationIds.length < 2) return []
  const lineSegments = project.geometry.segments.filter(segment => segment.lineId === lineId)
  const result: StationSpacing[] = []
  for (let index = 0; index < stationIds.length - 1; index += 1) {
    result.push(makeSpacing(project, lineId, stationIds[index], stationIds[index + 1], lineSegments))
  }
  if (isClosedRing(stationIds, lineSegments)) {
    result.push(makeSpacing(project, lineId, stationIds.at(-1)!, stationIds[0], lineSegments, new Set(result.map(item => item.segmentId))))
  }
  return result
}

function makeSpacing(project: ActualRouteProject, lineId: string, fromStationId: string, toStationId: string, segments: Segment[], usedSegmentIds = new Set<string>()): StationSpacing {
  const matches = segments.filter(segment => !usedSegmentIds.has(segment.id) && sameUndirectedPair(segment, fromStationId, toStationId))
  if (matches.length === 0) throw new Error(`线路 ${lineId} 缺少 ${fromStationId}—${toStationId} 的几何区间`)
  if (matches.length > 1) throw new Error(`线路 ${lineId} 的 ${fromStationId}—${toStationId} 存在多个几何区间`)
  const segment = matches[0]
  const distanceWorld = getSegmentDistanceWorld(project, segment)
  return {
    lineId,
    segmentId: segment.id,
    fromStationId,
    toStationId,
    distanceWorld,
    distanceMeters: worldUnitsToMeters(distanceWorld, project),
    distanceKilometers: worldUnitsToKilometers(distanceWorld, project),
  }
}

function resolveSegment(project: ActualRouteProject, segment: SegmentReference): Segment {
  if (typeof segment !== 'string') return segment
  const resolved = project.geometry.segments.find(item => item.id === segment)
  if (!resolved) throw new Error(`未找到区间 ${segment}`)
  return resolved
}

function sameUndirectedPair(segment: Segment, a: string, b: string) {
  return (segment.fromStationId === a && segment.toStationId === b) || (segment.fromStationId === b && segment.toStationId === a)
}

function isClosedRing(stationIds: string[], segments: Segment[]) {
  if (stationIds.length < 3 || segments.length !== stationIds.length) return false
  const stationSet = new Set(stationIds)
  const degree = new Map<string, number>()
  for (const segment of segments) {
    if (!stationSet.has(segment.fromStationId) || !stationSet.has(segment.toStationId)) return false
    degree.set(segment.fromStationId, (degree.get(segment.fromStationId) ?? 0) + 1)
    degree.set(segment.toStationId, (degree.get(segment.toStationId) ?? 0) + 1)
  }
  return stationIds.every(stationId => degree.get(stationId) === 2) && Boolean(segments.find(segment => sameUndirectedPair(segment, stationIds.at(-1)!, stationIds[0])))
}
