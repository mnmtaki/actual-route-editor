import type { ActualRouteProject, Segment, Waypoint } from '../data/model'
import { getStationAnchorForLine } from '../data/stationAnchor'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from '../import-export/aarcGeometry'

interface RawAarcPoint {
  id?: unknown
  pos?: unknown
  sta?: unknown
  dir?: unknown
  free?: unknown
}

interface RawAarcLine {
  id?: unknown
  pts?: unknown
}

interface RawAarcSave {
  points?: unknown
  lines?: unknown
}

interface PointPosition { x: number; y: number }

const finiteId = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

const validPosition = (value: unknown): PointPosition | null => Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(Number(value[0]))
  && Number.isFinite(Number(value[1]))
  ? { x: Number(value[0]), y: Number(value[1]) }
  : null

const sourceLineIdOf = (project: ActualRouteProject, lineId: string): number | null => {
  const value = project.lines.find(line => line.id === lineId)?.source?.sourceLineId
  return finiteId(value)
}

const rawSaveOf = (project: ActualRouteProject): RawAarcSave | null => {
  const raw = project.aarc?.raw
  return raw && typeof raw === 'object' ? raw as RawAarcSave : null
}

const rawPointMapOf = (project: ActualRouteProject) => {
  const raw = rawSaveOf(project)
  const map = new Map<number, RawAarcPoint>()
  if (!Array.isArray(raw?.points)) return map
  for (const value of raw.points) {
    if (!value || typeof value !== 'object') continue
    const point = value as RawAarcPoint
    const id = finiteId(point.id)
    if (id !== null && !map.has(id)) map.set(id, point)
  }
  return map
}

const rawLineMapOf = (project: ActualRouteProject) => {
  const raw = rawSaveOf(project)
  const map = new Map<number, RawAarcLine>()
  if (!Array.isArray(raw?.lines)) return map
  for (const value of raw.lines) {
    if (!value || typeof value !== 'object') continue
    const line = value as RawAarcLine
    const id = finiteId(line.id)
    if (id !== null && !map.has(id)) map.set(id, line)
  }
  return map
}

function rawPointIds(line: RawAarcLine | undefined): number[] {
  return Array.isArray(line?.pts)
    ? line.pts.map(finiteId).filter((id): id is number => id !== null)
    : []
}

function currentSourcePointPosition(
  project: ActualRouteProject,
  lineId: string,
  pointId: number,
  rawPoints: Map<number, RawAarcPoint>,
): PointPosition | null {
  for (const segment of project.geometry.segments) {
    if (segment.lineId !== lineId) continue
    const waypoint = segment.waypoints.find(item =>
      item.source?.format === 'aarc'
      && item.source.kind === 'explicit-control-point'
      && item.source.pointId === pointId)
    if (waypoint) return { x: waypoint.x, y: waypoint.y }
  }

  for (const segment of project.geometry.segments) {
    if (segment.lineId !== lineId) continue
    const ids = segment.source?.pointIds
    if (!ids?.length) continue
    if (ids[0] === pointId) {
      const anchor = getStationAnchorForLine(project, segment.fromStationId, lineId)
      if (anchor) return anchor
    }
    if (ids.at(-1) === pointId) {
      const anchor = getStationAnchorForLine(project, segment.toStationId, lineId)
      if (anchor) return anchor
    }
  }

  const directStation = project.stations.find(station => station.source?.format === 'aarc' && station.source.pointId === pointId)
  if (directStation) {
    const anchor = getStationAnchorForLine(project, directStation.id, lineId)
    if (anchor) return anchor
  }

  const clusteredStation = project.stations.find(station => station.source?.format === 'aarc' && station.source.pointIds?.includes(pointId))
  if (clusteredStation) {
    const anchor = getStationAnchorForLine(project, clusteredStation.id, lineId)
    const canonicalId = clusteredStation.source?.pointId
    const canonicalRaw = canonicalId === undefined ? null : validPosition(rawPoints.get(canonicalId)?.pos)
    const targetRaw = validPosition(rawPoints.get(pointId)?.pos)
    if (anchor && canonicalRaw && targetRaw) {
      return {
        x: targetRaw.x + (anchor.x - canonicalRaw.x),
        y: targetRaw.y + (anchor.y - canonicalRaw.y),
      }
    }
  }

  return validPosition(rawPoints.get(pointId)?.pos)
}

function buildCurrentLinePoints(project: ActualRouteProject, lineId: string): AarcGeometryPoint[] {
  const sourceLineId = sourceLineIdOf(project, lineId)
  if (sourceLineId === null) return []
  const rawLines = rawLineMapOf(project)
  const rawPoints = rawPointMapOf(project)
  return rawPointIds(rawLines.get(sourceLineId)).flatMap(pointId => {
    const rawPoint = rawPoints.get(pointId)
    const position = rawPoint ? currentSourcePointPosition(project, lineId, pointId, rawPoints) : null
    if (!rawPoint || !position) return []
    return [{
      id: pointId,
      x: position.x,
      y: position.y,
      dir: rawPoint.dir === 1 ? 1 as const : 0 as const,
      station: rawPoint.sta === 1,
      free: rawPoint.free === true,
    }]
  })
}

function sourceSegmentOrder(segment: Segment, fallback: number): number {
  const value = segment.source?.raw?.sourceSegmentIndex
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function rebuildLineSegments(project: ActualRouteProject, lineId: string): Segment[] | null {
  const sourceLineId = sourceLineIdOf(project, lineId)
  if (sourceLineId === null) return null
  const points = buildCurrentLinePoints(project, lineId)
  if (points.length < 2) return null
  const reconstructed = reconstructAarcLineGeometry(points)
  const lineSegments = project.geometry.segments
    .map((segment, index) => ({ segment, index }))
    .filter(item => item.segment.lineId === lineId && item.segment.source?.format === 'aarc')
    .sort((a, b) => sourceSegmentOrder(a.segment, a.index) - sourceSegmentOrder(b.segment, b.index))
  if (!lineSegments.length) return null

  const existingExplicit = new Map<number, Waypoint>()
  for (const { segment } of lineSegments) {
    for (const waypoint of segment.waypoints) {
      if (waypoint.source?.format === 'aarc'
        && waypoint.source.kind === 'explicit-control-point'
        && waypoint.source.pointId !== undefined
        && !existingExplicit.has(waypoint.source.pointId)) {
        existingExplicit.set(waypoint.source.pointId, waypoint)
      }
    }
  }

  const replacements = new Map<string, Segment>()
  let sourceCursor = 0
  let nodeCursor = 0

  for (const { segment } of lineSegments) {
    const endpointIds = segment.source?.pointIds
    if (!endpointIds?.length) continue
    const fromPointId = endpointIds[0]
    const toPointId = endpointIds.at(-1)!
    let fromSourceIndex = -1
    for (let index = sourceCursor; index < points.length; index += 1) {
      if (points[index].id === fromPointId) { fromSourceIndex = index; break }
    }
    if (fromSourceIndex < 0) continue
    let toSourceIndex = -1
    for (let index = fromSourceIndex + 1; index < points.length; index += 1) {
      if (points[index].id === toPointId) { toSourceIndex = index; break }
    }
    if (toSourceIndex < 0) continue

    let fromNodeIndex = -1
    for (let index = nodeCursor; index < reconstructed.nodes.length; index += 1) {
      if (reconstructed.nodes[index].sourcePointIndex === fromSourceIndex) { fromNodeIndex = index; break }
    }
    if (fromNodeIndex < 0) continue
    let toNodeIndex = -1
    for (let index = fromNodeIndex + 1; index < reconstructed.nodes.length; index += 1) {
      if (reconstructed.nodes[index].sourcePointIndex === toSourceIndex) { toNodeIndex = index; break }
    }
    if (toNodeIndex < 0) continue

    const oldImplicit = segment.waypoints.filter(waypoint => waypoint.source?.kind === 'implicit-corner')
    let implicitOrdinal = 0
    const waypoints: Waypoint[] = []
    for (const node of reconstructed.nodes.slice(fromNodeIndex + 1, toNodeIndex)) {
      if (node.sourcePointIndex !== undefined) {
        const sourcePoint = points[node.sourcePointIndex]
        if (sourcePoint.station) continue
        const existing = existingExplicit.get(sourcePoint.id)
        waypoints.push({
          ...(existing ?? {
            id: `aarc-waypoint-${sourceLineId}-${sourcePoint.id}`,
            type: 'corner' as const,
            source: {
              format: 'aarc' as const,
              pointId: sourcePoint.id,
              lineId: sourceLineId,
              sourceLineId,
              kind: 'explicit-control-point' as const,
            },
          }),
          x: node.x,
          y: node.y,
          type: 'corner',
          free: sourcePoint.free === true,
        })
        continue
      }

      const existing = oldImplicit[implicitOrdinal]
      waypoints.push({
        ...(existing ?? {
          id: `aarc-corner-${sourceLineId}-${sourceSegmentOrder(segment, 0)}-${implicitOrdinal}`,
          type: 'corner' as const,
          source: {
            format: 'aarc' as const,
            lineId: sourceLineId,
            sourceLineId,
            kind: 'implicit-corner' as const,
          },
        }),
        x: node.x,
        y: node.y,
        type: 'corner',
        free: false,
      })
      implicitOrdinal += 1
    }

    replacements.set(segment.id, { ...segment, waypoints })
    sourceCursor = toSourceIndex
    nodeCursor = toNodeIndex
  }

  return project.geometry.segments.map(segment => replacements.get(segment.id) ?? segment)
}

export function getAarcLinesForSourcePoint(project: ActualRouteProject, pointId: number): Set<string> {
  const result = new Set<string>()
  const rawLines = rawLineMapOf(project)
  for (const line of project.lines) {
    if (line.source?.format !== 'aarc') continue
    const sourceLineId = sourceLineIdOf(project, line.id)
    if (sourceLineId === null) continue
    if (rawPointIds(rawLines.get(sourceLineId)).includes(pointId)) result.add(line.id)
  }
  return result
}

export function getAarcLinesForStation(project: ActualRouteProject, stationId: string): Set<string> {
  const station = project.stations.find(item => item.id === stationId)
  if (!station?.source || station.source.format !== 'aarc') return new Set()
  const pointIds = new Set<number>([
    ...(station.source.pointId !== undefined ? [station.source.pointId] : []),
    ...(station.source.pointIds ?? []),
  ])
  const result = new Set<string>()
  for (const pointId of pointIds) for (const lineId of getAarcLinesForSourcePoint(project, pointId)) result.add(lineId)
  return result
}

export function reformalizeAarcLines(project: ActualRouteProject, lineIds: Iterable<string>): ActualRouteProject {
  const ids = [...new Set(lineIds)]
  if (!ids.length) return project
  let segments = project.geometry.segments
  let changed = false
  let working: ActualRouteProject = project
  for (const lineId of ids) {
    const nextSegments = rebuildLineSegments(working, lineId)
    if (!nextSegments) continue
    segments = nextSegments
    working = { ...working, geometry: { ...working.geometry, segments } }
    changed = true
  }
  return changed ? working : project
}

export function moveAarcExplicitControlPoint(
  project: ActualRouteProject,
  pointId: number,
  position: PointPosition,
): ActualRouteProject {
  let matched = false
  const segments = project.geometry.segments.map(segment => {
    let changed = false
    const waypoints = segment.waypoints.map(waypoint => {
      if (waypoint.source?.format !== 'aarc'
        || waypoint.source.kind !== 'explicit-control-point'
        || waypoint.source.pointId !== pointId) return waypoint
      matched = true
      changed = true
      return { ...waypoint, x: position.x, y: position.y }
    })
    return changed ? { ...segment, waypoints } : segment
  })
  const next = matched ? { ...project, geometry: { ...project.geometry, segments } } : project
  return reformalizeAarcLines(next, getAarcLinesForSourcePoint(next, pointId))
}

export function reformalizeAarcAfterStationMove(project: ActualRouteProject, stationId: string): ActualRouteProject {
  return reformalizeAarcLines(project, getAarcLinesForStation(project, stationId))
}

export function isAarcDerivedWaypoint(waypoint: Waypoint): boolean {
  return waypoint.source?.format === 'aarc' && waypoint.source.kind === 'implicit-corner'
}
