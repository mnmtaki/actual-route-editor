import type { ActualRouteProject, Segment, Station, Waypoint } from './model'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from '../import-export/aarcGeometry'
import { buildAarcStationComponents, createAarcFreeSnapCandidateResolver, resolveAarcStationName, type AarcStationPointInput } from '../import-export/aarcStationClustering'
import { detectAarcCompoundGroups } from '../import-export/aarcCompoundStations'
import { aggregateAarcPointMetrics } from '../import-export/aarcNormalize'
import { getAarcCompoundGroupId } from './compoundStation'
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
function sourceSave(project: ActualRouteProject): Record<string, unknown> {
  return project.aarc?.raw && typeof project.aarc.raw === 'object' ? project.aarc.raw : {}
}
function sourceConfig(project: ActualRouteProject): Record<string, unknown> {
  const value = project.aarc?.config ?? sourceSave(project).config
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function sourceLines(project: ActualRouteProject): RawAarcLine[] {
  const raw = sourceSave(project).lines
  return Array.isArray(raw) ? raw.filter((item): item is RawAarcLine => Boolean(item && typeof item === 'object')) : []
}
function sourcePoints(project: ActualRouteProject): RawAarcPoint[] {
  const raw = sourceSave(project).points
  return Array.isArray(raw) ? raw.filter((item): item is RawAarcPoint => Boolean(item && typeof item === 'object')) : []
}
function sourcePointLinks(project: ActualRouteProject): unknown {
  return project.aarc?.pointLinks ?? sourceSave(project).pointLinks ?? []
}
function existingStationForPoint(project: ActualRouteProject, pointId: number): Station | undefined {
  return project.stations.find(station => station.source?.pointId === pointId)
    ?? project.stations.find(station => station.source?.pointIds?.includes(pointId))
}
function uniqueStationId(project: ActualRouteProject, sourceLineId: number, pointId: number) {
  const preferred = `aarc-station-${pointId}`
  if (!project.stations.some(station => station.id === preferred)) return preferred
  return `aarc-promoted-station-${sourceLineId}-${pointId}`
}
function appendSourcePointIds(station: Station, pointIds: number[]) {
  if (station.source?.format !== 'aarc') return
  const current = station.source.pointIds ?? (station.source.pointId === undefined ? [] : [station.source.pointId])
  station.source.pointIds = [...new Set([...current, ...pointIds])]
}
function makeStation(project: ActualRouteProject, sourceLineId: number, point: RawAarcPoint, pointId: number, position: [number, number], referencedPointIds: number[], resolvedName?: { name: string; nameSub: string; pointId: number }): Station {
  const nameP = pair(point.nameP)
  const ownName = typeof point.name === 'string' && point.name.trim() ? point.name : undefined
  const ownNameS = typeof point.nameS === 'string' && point.nameS.length ? point.nameS : undefined
  const borrowedName = resolvedName?.name && !resolvedName.name.startsWith('#') ? resolvedName.name : undefined
  return {
    id: uniqueStationId(project, sourceLineId, pointId),
    name: ownName ?? borrowedName ?? `未命名站 ${pointId}`,
    ...(ownNameS !== undefined ? { nameS: ownNameS } : resolvedName?.nameSub ? { nameS: resolvedName.nameSub } : {}),
    ...(point.free === true ? { free: true } : {}),
    x: position[0],
    y: position[1],
    labelOffsetX: nameP?.[0] ?? 14,
    labelOffsetY: nameP?.[1] ?? -14,
    source: {
      format: 'aarc',
      pointId,
      pointIds: referencedPointIds,
      ...(resolvedName && resolvedName.pointId !== pointId ? { resolvedNameSourcePointId: resolvedName.pointId } : {}),
      ...(nameP ? { nameP, labelAnchorMode: 'aarc-block' as const } : {}),
      raw: structuredClone(point),
    },
  }
}

/**
 * Convert the preserved geometry of one imported AARC fake common line into
 * ordinary ActualRoute station/relation/segment data. The line may still stay
 * isFake=true; passenger semantics are activated only when the caller clears it.
 *
 * Station identity deliberately reuses the same upstream-derived cluster
 * machinery as the normal AARC importer:
 * - automatic staClusters use snap size, free-point candidates and clingingDist;
 * - explicit pointLinks[type=4] create forced compound passenger identity;
 * - other pointLink types never create passenger identity.
 *
 * Existing real stations win as the canonical object when a newly promoted
 * fake point joins an already-imported automatic cluster. This preserves the
 * current project's geometry while making the promoted service passenger-
 * equivalent to a normal AARC import.
 */
export function materializeAarcFakeLineService(project: ActualRouteProject, lineId: string): ActualRouteProject {
  const line = project.lines.find(item => item.id === lineId)
  if (!line || line.source?.format !== 'aarc') return project
  if (line.stationSequence.length || project.geometry.segments.some(segment => segment.lineId === lineId) || project.stationLineRelations.some(relation => relation.lineId === lineId)) return project

  const sourceLineId = finite(line.source.sourceLineId ?? line.source.lineId)
  if (sourceLineId === undefined) return project
  const rawLines = sourceLines(project)
  const rawLine = rawLines.find(item => finite(item.id) === sourceLineId)
  if (!rawLine || rawLine.isFake !== true || Number(rawLine.type ?? 0) === 1 || !Array.isArray(rawLine.pts)) return project

  const rawPoints = sourcePoints(project)
  const rawPointMap = new Map<number, RawAarcPoint>()
  for (const point of rawPoints) {
    const pointId = finite(point.id)
    if (pointId !== undefined && !rawPointMap.has(pointId)) rawPointMap.set(pointId, point)
  }

  const geometryPoints: AarcGeometryPoint[] = rawLine.pts.flatMap(value => {
    const pointId = finite(value), point = pointId === undefined ? undefined : rawPointMap.get(pointId), position = point ? pair(point.pos) : undefined
    if (pointId === undefined || !point || !position) return []
    return [{ id: pointId, x: position[0], y: position[1], dir: finite(point.dir) === 1 ? 1 as const : 0 as const, station: finite(point.sta) === 1, ...(point.free === true ? { free: true } : {}) }]
  })
  const targetStationPointIds = new Set(geometryPoints.filter(point => point.station).map(point => point.id))
  if (!targetStationPointIds.size) return project

  const stationPointInputs: AarcStationPointInput[] = rawPoints.flatMap((point, sourceOrder) => {
    const pointId = finite(point.id), position = pair(point.pos)
    if (pointId === undefined || finite(point.sta) !== 1 || !position) return []
    return [{
      id: pointId,
      x: position[0],
      y: position[1],
      sourceOrder,
      ...(typeof point.name === 'string' && point.name.trim() ? { name: point.name } : {}),
      ...(typeof point.nameS === 'string' && point.nameS.length ? { nameS: point.nameS } : {}),
      ...(pair(point.nameP) ? { nameP: pair(point.nameP) } : {}),
      ...(point.free === true ? { free: true } : {}),
    }]
  })

  const operatingSourceLineIds = new Set(project.lines.flatMap(item => {
    if (item.source?.format !== 'aarc' || (item.isFake && item.id !== lineId)) return []
    const id = finite(item.source.sourceLineId ?? item.source.lineId)
    return id === undefined ? [] : [id]
  }))
  operatingSourceLineIds.add(sourceLineId)

  const passengerMemberships = new Map<number, number[]>()
  const sourcePointMemberships = new Map<number, number[]>()
  for (const [lineOrder, sourceLine] of rawLines.entries()) {
    const sourceId = finite(sourceLine.id) ?? lineOrder
    if (finite(sourceLine.id) === undefined) continue
    for (const rawPointId of Array.isArray(sourceLine.pts) ? sourceLine.pts : []) {
      const pointId = finite(rawPointId)
      if (pointId === undefined || finite(rawPointMap.get(pointId)?.sta) !== 1) continue
      const all = sourcePointMemberships.get(pointId) ?? []
      if (!all.includes(sourceId)) all.push(sourceId)
      sourcePointMemberships.set(pointId, all)
      if (!operatingSourceLineIds.has(sourceId)) continue
      const passenger = passengerMemberships.get(pointId) ?? []
      if (!passenger.includes(sourceId)) passenger.push(sourceId)
      passengerMemberships.set(pointId, passenger)
    }
  }

  const config = sourceConfig(project)
  const sourceLineRecords = rawLines as Array<Record<string, unknown>>
  const clingingDistance = finite(config.snapOctaClingPtPtDist) ?? 25
  const snapSizesByPoint = new Map(stationPointInputs.map(point => [point.id, aggregateAarcPointMetrics(point.id, sourceLineRecords, sourcePointMemberships, config).ptSnapSize]))
  const sourcePointPositions = new Map<number, { x: number; y: number }>(rawPoints.flatMap(point => {
    const pointId = finite(point.id), position = pair(point.pos)
    return pointId === undefined || !position ? [] : [[pointId, { x: position[0], y: position[1] }] as const]
  }))
  const sourceLineChains = rawLines.map(sourceLine => ({ pts: (Array.isArray(sourceLine.pts) ? sourceLine.pts : []).map(finite).filter((id): id is number => id !== undefined) }))
  const freeSnapCandidates = createAarcFreeSnapCandidateResolver(sourcePointPositions, sourceLineChains, pointId => (snapSizesByPoint.get(pointId) ?? 1) * clingingDistance)
  const stationClustering = buildAarcStationComponents(stationPointInputs, passengerMemberships, {
    configClingingDist: clingingDistance,
    getSnapSize: pointId => snapSizesByPoint.get(pointId) ?? 1,
    getSnapCandidates: freeSnapCandidates,
  })
  const compoundDetection = detectAarcCompoundGroups(
    stationPointInputs.map(point => ({ id: point.id, x: point.x, y: point.y, sta: 1, ...(point.name ? { name: point.name } : {}), sourceOrder: point.sourceOrder, ...(point.free ? { free: true } : {}) })),
    [],
    passengerMemberships,
    {
      configClingingDist: clingingDistance,
      getSnapSize: pointId => snapSizesByPoint.get(pointId) ?? 1,
      getSnapCandidates: freeSnapCandidates,
      pointLinks: sourcePointLinks(project),
    },
  )
  const nameInputs = stationPointInputs.map(point => ({ id: point.id, name: point.name, nameS: point.nameS, sourceOrder: point.sourceOrder }))
  const resolvedNames = new Map(stationPointInputs.map(point => [point.id, resolveAarcStationName(point.id, nameInputs, sourcePointLinks(project), stationClustering.components)]))

  const next = structuredClone(project)
  const targetLine = next.lines.find(item => item.id === lineId)!
  const stationByPoint = new Map<number, Station>()
  for (const point of stationPointInputs) {
    const existing = existingStationForPoint(next, point.id)
    if (existing) stationByPoint.set(point.id, existing)
  }

  const createStation = (pointId: number, referencedPointIds: number[]): Station | undefined => {
    const existing = stationByPoint.get(pointId) ?? existingStationForPoint(next, pointId)
    if (existing) {
      stationByPoint.set(pointId, existing)
      return existing
    }
    const rawPoint = rawPointMap.get(pointId), position = rawPoint ? pair(rawPoint.pos) : undefined
    if (!rawPoint || !position) return undefined
    const station = makeStation(next, sourceLineId, rawPoint, pointId, position, referencedPointIds, resolvedNames.get(pointId))
    next.stations.push(station)
    stationByPoint.set(pointId, station)
    return station
  }

  for (const component of stationClustering.components) {
    if (!component.referencedPointIds.some(pointId => targetStationPointIds.has(pointId))) continue
    const membershipsForComponent = component.referencedPointIds.flatMap(pointId => passengerMemberships.get(pointId) ?? [])
    const hasRepeatedLineOccurrence = membershipsForComponent.some((sourceId, index) => membershipsForComponent.indexOf(sourceId) !== index)

    if (hasRepeatedLineOccurrence) {
      for (const pointId of component.referencedPointIds) {
        if (!stationByPoint.has(pointId) && targetStationPointIds.has(pointId)) createStation(pointId, component.referencedPointIds)
      }
      continue
    }

    const existingCanonical = component.pointIds.map(pointId => stationByPoint.get(pointId) ?? existingStationForPoint(next, pointId)).find((station): station is Station => Boolean(station))
    const canonical = existingCanonical ?? createStation(component.canonicalPointId, component.referencedPointIds)
    if (!canonical) continue
    if (component.pointIds.some(pointId => rawPointMap.get(pointId)?.free === true)) canonical.free = true
    appendSourcePointIds(canonical, component.referencedPointIds)
    for (const pointId of component.pointIds) stationByPoint.set(pointId, canonical)
  }

  for (const pointId of targetStationPointIds) {
    if (!stationByPoint.has(pointId)) createStation(pointId, [pointId])
  }

  for (const group of compoundDetection.groups) {
    const memberStations = [...new Set(group.pointIds.map(pointId => stationByPoint.get(pointId)?.id).filter((id): id is string => Boolean(id)))]
    if (memberStations.length < 2) continue
    const groupId = getAarcCompoundGroupId(group.pointIds)
    for (const stationId of memberStations) {
      const station = next.stations.find(item => item.id === stationId)
      if (station) station.compoundGroupId = groupId
    }
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
      const station = stationByPoint.get(sourcePoint.id)
      if (!station) continue
      if (!relatedStationIds.has(station.id)) {
        const anchor = normalizeStationAnchor({ x: sourcePoint.x, y: sourcePoint.y }, station)
        next.stationLineRelations.push({
          id: `aarc-promoted-relation-${sourceLineId}-${station.source?.pointId ?? sourcePoint.id}`,
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
