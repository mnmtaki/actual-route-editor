import type { ActualRouteProject, Segment, Station, Waypoint } from './model'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from '../import-export/aarcGeometry'
import { normalizeStationAnchor } from './stationAnchor'

interface RawAarcPoint extends Record<string, unknown> {
  id?: unknown
  pos?: unknown
  sta?: unknown
  dir?: unknown
  name?: unknown
  nameS?: unknown
  nameP?: unknown
  free?: unknown
}
interface RawAarcLine extends Record<string, unknown> {
  id?: unknown
  pts?: unknown
  type?: unknown
  isFake?: unknown
}

function finite(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
function pair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const x = finite(value[0]), y = finite(value[1])
  return x === undefined || y === undefined ? undefined : [x, y]
}
function sourceLines(project: ActualRouteProject): RawAarcLine[] {
  const raw = project.aarc?.raw?.lines
  return Array.isArray(raw) ? raw.filter((item): item is RawAarcLine => Boolean(item && typeof item === 'object')) : []
}
function sourcePoints(project: ActualRouteProject): RawAarcPoint[] {
  const raw = project.aarc?.raw?.points
  return Array.isArray(raw) ? raw.filter((item): item is RawAarcPoint => Boolean(item && typeof item === 'object')) : []
}
function existingStationForPoint(project: ActualRouteProject, pointId: number): Station | undefined {
  return project.stations.find(station => station.source?.pointId === pointId || station.source?.pointIds?.includes(pointId))
}
function uniqueStationId(project: ActualRouteProject, sourceLineId: number, pointId: number) {
  const preferred = `aarc-station-${pointId}`
  if (!project.stations.some(station => station.id === preferred)) return preferred
  return `aarc-promoted-station-${sourceLineId}-${pointId}`
}
function makeStation(project: ActualRouteProject, sourceLineId: number, point: RawAarcPoint, pointId: number, position: [number, number]): Station {
  const nameP = pair(point.nameP)
  return {
    id: uniqueStationId(project, sourceLineId, pointId),
    name: typeof point.name === 'string' && point.name.trim() ? point.name : `未命名站 ${pointId}`,
    ...(typeof point.nameS === 'string' && point.nameS ? { nameS: point.nameS } : {}),
    ...(point.free === true ? { free: true } : {}),
    x: position[0],
    y: position[1],
    labelOffsetX: nameP?.[0] ?? 14,
    labelOffsetY: nameP?.[1] ?? -14,
    source: {
      format: 'aarc',
      pointId,
      pointIds: [pointId],
      ...(nameP ? { nameP, labelAnchorMode: 'aarc-block' as const } : {}),
      raw: structuredClone(point),
    },
  }
}

/**
 * Convert the preserved geometry of one imported AARC fake common line into
 * ordinary ActualRoute station/relation/segment data. The line may still stay
 * isFake=true; passenger semantics are activated only when the caller clears it.
 */
export function materializeAarcFakeLineService(project: ActualRouteProject, lineId: string): ActualRouteProject {
  const line = project.lines.find(item => item.id === lineId)
  if (!line || line.source?.format !== 'aarc') return project
  if (line.stationSequence.length || project.geometry.segments.some(segment => segment.lineId === lineId) || project.stationLineRelations.some(relation => relation.lineId === lineId)) return project

  const sourceLineId = finite(line.source.sourceLineId ?? line.source.lineId)
  if (sourceLineId === undefined) return project
  const rawLine = sourceLines(project).find(item => finite(item.id) === sourceLineId)
  if (!rawLine || rawLine.isFake !== true || Number(rawLine.type ?? 0) === 1 || !Array.isArray(rawLine.pts)) return project

  const rawPointMap = new Map<number, RawAarcPoint>()
  for (const point of sourcePoints(project)) {
    const pointId = finite(point.id)
    if (pointId !== undefined && !rawPointMap.has(pointId)) rawPointMap.set(pointId, point)
  }
  const geometryPoints: AarcGeometryPoint[] = rawLine.pts.flatMap(value => {
    const pointId = finite(value), point = pointId === undefined ? undefined : rawPointMap.get(pointId), position = point ? pair(point.pos) : undefined
    if (pointId === undefined || !point || !position) return []
    return [{ id: pointId, x: position[0], y: position[1], dir: finite(point.dir) === 1 ? 1 as const : 0 as const, station: finite(point.sta) === 1, ...(point.free === true ? { free: true } : {}) }]
  })
  if (!geometryPoints.some(point => point.station)) return project

  const next = structuredClone(project)
  const targetLine = next.lines.find(item => item.id === lineId)!
  const pointStations = new Map<number, Station>()
  const ensureStation = (pointId: number): Station | undefined => {
    const cached = pointStations.get(pointId)
    if (cached) return cached
    const reused = existingStationForPoint(next, pointId)
    if (reused) { pointStations.set(pointId, reused); return reused }
    const rawPoint = rawPointMap.get(pointId), position = rawPoint ? pair(rawPoint.pos) : undefined
    if (!rawPoint || !position) return undefined
    const station = makeStation(next, sourceLineId, rawPoint, pointId, position)
    next.stations.push(station)
    pointStations.set(pointId, station)
    return station
  }

  const reconstructed = reconstructAarcLineGeometry(geometryPoints)
  let previousStation: Station | undefined
  let pendingWaypoints: Waypoint[] = []
  let segmentIndex = 0
  const relatedStationIds = new Set<string>()

  for (const [nodeIndex, node] of reconstructed.nodes.entries()) {
    const sourcePointIndex = node.sourcePointIndex
    const sourcePoint = sourcePointIndex === undefined ? undefined : geometryPoints[sourcePointIndex]
    if (sourcePoint?.station) {
      const station = ensureStation(sourcePoint.id)
      if (!station) continue
      if (!relatedStationIds.has(station.id)) {
        const anchor = normalizeStationAnchor({ x: sourcePoint.x, y: sourcePoint.y }, station)
        next.stationLineRelations.push({
          id: `aarc-promoted-relation-${sourceLineId}-${sourcePoint.id}`,
          stationId: station.id,
          lineId,
          openedAt: targetLine.openedAt,
          closedAt: targetLine.closedAt ?? null,
          ...(anchor ? { anchor } : {}),
        })
        relatedStationIds.add(station.id)
      }
      if (!targetLine.stationSequence.length || targetLine.stationSequence.at(-1) !== station.id) targetLine.stationSequence.push(station.id)
      if (previousStation && previousStation.id !== station.id) {
        const segment: Segment = {
          id: `aarc-promoted-segment-${sourceLineId}-${segmentIndex}`,
          lineId,
          fromStationId: previousStation.id,
          toStationId: station.id,
          mode: pendingWaypoints.length ? 'rounded' : 'straight',
          ...(pendingWaypoints.length ? { cornerRadius: 42 } : {}),
          structureType: 'underground',
          structureNodes: [],
          waypoints: pendingWaypoints,
          openedAt: targetLine.openedAt,
          closedAt: targetLine.closedAt,
          source: { format: 'aarc', lineId: sourceLineId, sourceLineId, raw: { promotedFromFakeLine: true, sourceSegmentIndex: segmentIndex } },
        }
        next.geometry.segments.push(segment)
        segmentIndex += 1
      }
      previousStation = station
      pendingWaypoints = []
      continue
    }
    if (!previousStation) continue
    pendingWaypoints.push({
      id: sourcePoint
        ? `aarc-promoted-waypoint-${sourceLineId}-${sourcePoint.id}-${nodeIndex}`
        : `aarc-promoted-corner-${sourceLineId}-${nodeIndex}`,
      x: node.x,
      y: node.y,
      type: 'corner',
      ...(sourcePoint?.free ? { free: true } : {}),
      source: {
        format: 'aarc',
        ...(sourcePoint ? { pointId: sourcePoint.id } : {}),
        lineId: sourceLineId,
        sourceLineId,
        kind: sourcePoint ? 'explicit-control-point' : 'implicit-corner',
        ...(sourcePoint ? { raw: structuredClone(rawPointMap.get(sourcePoint.id) ?? {}) } : {}),
      },
    })
  }

  return next
}
