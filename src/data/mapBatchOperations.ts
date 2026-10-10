import type { ActualRouteProject } from './model'
import type { MapItemSelection } from './mapMarquee'
import { isLineLocked, isSegmentGeometryLocked, isStationGeometryLocked } from './lineLock'
import { translateStationWithAnchors } from './stationAnchor'
import { deleteLineAndOrphans, deleteStationConsistently } from './operations'
import { deleteStructureNode, getStructureNodePoint } from './structure'
import { findSegmentProgressForPoint } from '../geometry/path'
import { moveAarcTextTags, ownerLineForAarcTag, removeAarcTextTags } from './aarcTextTagLifecycle'

type Result = { project: ActualRouteProject; blocked?: string; changed: boolean }
const success = (project: ActualRouteProject): Result => ({ project, changed: true })
const blocked = (project: ActualRouteProject, reason: string): Result => ({ project, changed: false, blocked: reason })
const ownerLocked = (project: ActualRouteProject, lineId: string) => isLineLocked(project, lineId)
const selectedId = (selection: MapItemSelection, type: MapItemSelection['type']) => selection.type === type
const idsByType = (items: readonly MapItemSelection[], type: MapItemSelection['type']) => new Set(items.filter(item => selectedId(item, type) && 'id' in item).map(item => 'id' in item ? item.id : ''))
const sourceId = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : null }
const fakeSourceId = (line: ActualRouteProject['lines'][number]) => line.isFake && line.source?.format === 'aarc' ? sourceId(line.source.sourceLineId ?? line.source.lineId) : null

/** Expand selected whole lines and segments to their native geometry exactly once. */
function geometryTargets(project: ActualRouteProject, items: readonly MapItemSelection[]) {
  const lineIds = idsByType(items, 'line')
  const segmentIds = idsByType(items, 'segment')
  const stations = idsByType(items, 'station')
  const waypoints = idsByType(items, 'waypoint')
  const structureNodes = idsByType(items, 'structureNode')
  for (const segment of project.geometry.segments) {
    if (!lineIds.has(segment.lineId) && !segmentIds.has(segment.id)) continue
    stations.add(segment.fromStationId)
    stations.add(segment.toStationId)
    for (const waypoint of segment.waypoints) waypoints.add(waypoint.id)
  }
  for (const line of project.lines) if (lineIds.has(line.id)) {
    for (const id of line.stationSequence) stations.add(id)
  }
  return { lineIds, segmentIds, stations, waypoints, structureNodes }
}

/** Moving a selected group must never silently move geometry owned by locked lines. */
export function moveSelectedMapObjects(project: ActualRouteProject, items: readonly MapItemSelection[], dx: number, dy: number): Result {
  if (!items.length || !Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return { project, changed: false }
  const target = geometryTargets(project, items)
  for (const id of target.lineIds) if (ownerLocked(project, id)) return blocked(project, '所选线路包含锁定线路，请先解锁')
  for (const id of target.segmentIds) if (isSegmentGeometryLocked(project, id)) return blocked(project, '所选区间属于锁定线路，请先解锁')
  for (const id of target.stations) if (isStationGeometryLocked(project, id)) return blocked(project, '所选车站关联锁定线路，请先解锁')
  for (const segment of project.geometry.segments) {
    if (segment.waypoints.some(point => target.waypoints.has(point.id)) || segment.structureNodes?.some(node => target.structureNodes.has(node.id))) {
      if (ownerLocked(project, segment.lineId)) return blocked(project, '所选控制点或样式点属于锁定线路')
    }
  }
  for (const item of items) {
    if (item.type === 'lineLabel' && ownerLocked(project, item.lineId)) return blocked(project, '线路标签所属线路已锁定')
    if ((item.type === 'road' || item.type === 'roadPoint') && project.roads?.find(road => road.id === (item.type === 'road' ? item.id : item.roadId))?.locked) return blocked(project, '所选道路已锁定')
    if (item.type === 'basemapPath' && project.basemapPaths?.find(path => path.id === item.id)?.locked) return blocked(project, '所选底图路径已锁定')
    if (item.type === 'lineLegend' && project.lineLegend?.locked) return blocked(project, '线路图例已锁定')
    if (item.type === 'background' && project.background?.locked) return blocked(project, '底图图片已锁定')
  }
  const next = structuredClone(project)
  for (const id of target.stations) translateStationWithAnchors(next, id, dx, dy)
  for (const segment of next.geometry.segments) {
    for (const point of segment.waypoints) if (target.waypoints.has(point.id)) { point.x += dx; point.y += dy }
  }
  // A free style point is represented by progress along the segment. Attached
  // points already follow the translated waypoint and must not move twice.
  for (const segment of next.geometry.segments) for (const node of segment.structureNodes ?? []) {
    if (!target.structureNodes.has(node.id) || node.waypointId || (target.segmentIds.has(segment.id) || target.lineIds.has(segment.lineId))) continue
    const originalSegment = project.geometry.segments.find(entry => entry.id === segment.id)
    const originalNode = originalSegment?.structureNodes?.find(entry => entry.id === node.id)
    if (!originalSegment || !originalNode) continue
    const point = getStructureNodePoint(project, originalSegment, originalNode)
    if (point) node.progress = findSegmentProgressForPoint(next, segment, { x: point.x + dx, y: point.y + dy })
  }

  const selectedLabels = idsByType(items, 'lineLabel')
  for (const line of next.lines) for (const label of line.lineBadges ?? []) {
    if (selectedLabels.has(label.id) || target.lineIds.has(line.id)) { label.x += dx; label.y += dy }
  }
  moveAarcTextTags(next, new Set((next.textTags ?? []).filter(tag => selectedLabels.has(tag.id) || idsByType(items, 'aarcTextTag').has(tag.id) || (ownerLineForAarcTag(next, tag) && target.lineIds.has(ownerLineForAarcTag(next, tag)!))).map(tag => tag.id)), dx, dy)
  const elementIds = idsByType(items, 'mapElement')
  for (const item of next.mapElements ?? []) if (elementIds.has(item.id)) { item.x += dx; item.y += dy }
  const roads = idsByType(items, 'road'), roadPoints = idsByType(items, 'roadPoint')
  for (const road of next.roads ?? []) for (const point of road.points) if (roads.has(road.id) || roadPoints.has(point.id)) { point.x += dx; point.y += dy }
  const paths = idsByType(items, 'basemapPath')
  for (const path of next.basemapPaths ?? []) if (paths.has(path.id)) for (const point of path.points) { point.x += dx; point.y += dy }
  if (next.lineLegend && idsByType(items, 'lineLegend').has(next.lineLegend.id)) { next.lineLegend.x += dx; next.lineLegend.y += dy }
  if (next.background && items.some(item => item.type === 'background')) { next.background.x += dx; next.background.y += dy }

  const fakeIds = new Set(next.lines.flatMap(line => target.lineIds.has(line.id) && fakeSourceId(line) !== null ? [fakeSourceId(line)!] : []))
  if (fakeIds.size && Array.isArray(next.aarc?.raw?.lines) && Array.isArray(next.aarc.raw.points)) {
    const sourceLines = next.aarc.raw.lines as Array<Record<string, unknown>>
    const affectedLines = sourceLines.filter(line => fakeIds.has(Number(line.id)))
    const pointIds = new Set(affectedLines.flatMap(line => Array.isArray(line.pts) ? line.pts.map(Number) : []))
    const unselectedSharing = sourceLines.some(line => !fakeIds.has(Number(line.id)) && Array.isArray(line.pts) && line.pts.some(id => pointIds.has(Number(id))))
    if (unselectedSharing) return blocked(project, 'AARC 伪线存在与未选线路共用的原始控制点，无法安全整体移动')
    for (const point of next.aarc.raw.points as Array<Record<string, unknown>>) {
      if (!pointIds.has(Number(point.id)) || !Array.isArray(point.pos)) continue
      point.pos = [Number(point.pos[0]) + dx, Number(point.pos[1]) + dy]
    }
  }
  return success(next)
}

/** Apply one atomic deletion in dependency order; locked dependencies abort it. */
export function deleteSelectedMapObjects(project: ActualRouteProject, items: readonly MapItemSelection[]): Result {
  if (!items.length) return { project, changed: false }
  const target = geometryTargets(project, items)
  for (const id of target.lineIds) {
    if (ownerLocked(project, id)) return blocked(project, '所选线路包含锁定线路，请先解锁')
    // Native deletion cascades to branches, including ones outside the box.
    let pending = [id], seen = new Set<string>()
    while (pending.length) {
      const parent = pending.shift()!
      if (seen.has(parent)) continue
      seen.add(parent)
      for (const child of project.lines.filter(line => line.parentLineId === parent)) {
        if (child.locked) return blocked(project, '所选主线关联锁定支线，请先解锁')
        pending.push(child.id)
      }
    }
  }
  for (const id of target.stations) if (isStationGeometryLocked(project, id)) return blocked(project, '所选车站关联锁定线路，请先解锁')
  for (const id of target.segmentIds) if (isSegmentGeometryLocked(project, id)) return blocked(project, '所选区间属于锁定线路')
  for (const segment of project.geometry.segments) if (segment.waypoints.some(point => target.waypoints.has(point.id)) || segment.structureNodes?.some(node => target.structureNodes.has(node.id))) {
    if (ownerLocked(project, segment.lineId)) return blocked(project, '所选控制点或样式点属于锁定线路')
  }
  for (const item of items) {
    if (item.type === 'lineLabel' && ownerLocked(project, item.lineId)) return blocked(project, '所选线路标签属于锁定线路')
    if ((item.type === 'road' || item.type === 'roadPoint') && project.roads?.find(road => road.id === (item.type === 'road' ? item.id : item.roadId))?.locked) return blocked(project, '所选道路已锁定')
    if (item.type === 'basemapPath' && project.basemapPaths?.find(path => path.id === item.id)?.locked) return blocked(project, '所选底图路径已锁定')
    if (item.type === 'lineLegend' && project.lineLegend?.locked) return blocked(project, '线路图例已锁定')
    if (item.type === 'background' && project.background?.locked) return blocked(project, '底图图片已锁定')
  }

  let next = project
  for (const id of target.lineIds) if (next.lines.some(line => line.id === id)) next = deleteLineAndOrphans(next, id)
  for (const id of idsByType(items, 'station')) if (next.stations.some(station => station.id === id)) next = deleteStationConsistently(next, id)
  next = structuredClone(next)
  const survivingSegmentIds = new Set(next.geometry.segments.map(segment => segment.id))
  const segmentDelete = idsByType(items, 'segment')
  next.geometry.segments = next.geometry.segments.filter(segment => !segmentDelete.has(segment.id))
  for (const segment of next.geometry.segments) {
    const removedWaypoints = new Set(segment.waypoints.filter(waypoint => target.waypoints.has(waypoint.id)).map(point => point.id))
    segment.waypoints = segment.waypoints.filter(waypoint => !removedWaypoints.has(waypoint.id))
    segment.structureNodes = (segment.structureNodes ?? []).filter(node => !removedWaypoints.has(node.waypointId ?? ''))
  }
  for (const item of items) if (item.type === 'structureNode') {
    if (next.geometry.segments.some(segment => segment.id === item.segmentId)) next = deleteStructureNode(next, item.segmentId, item.id)
  }
  const labels = idsByType(items, 'lineLabel')
  for (const line of next.lines) line.lineBadges = line.lineBadges?.filter(label => !labels.has(label.id))
  removeAarcTextTags(next, new Set([...labels, ...idsByType(items, 'aarcTextTag')]))
  const elements = idsByType(items, 'mapElement')
  next.mapElements = next.mapElements?.filter(element => !elements.has(element.id))
  const roads = idsByType(items, 'road'), roadPoints = idsByType(items, 'roadPoint')
  next.roads = next.roads?.filter(road => !roads.has(road.id)).map(road => ({ ...road, points: road.points.filter(point => !roadPoints.has(point.id)) }))
  const paths = idsByType(items, 'basemapPath')
  next.basemapPaths = next.basemapPaths?.filter(path => !paths.has(path.id))
  if (next.lineLegend && idsByType(items, 'lineLegend').has(next.lineLegend.id)) delete next.lineLegend
  if (items.some(item => item.type === 'background')) next.background = null
  const validSegments = new Set(next.geometry.segments.map(segment => segment.id))
  const validRelations = new Set(next.stationLineRelations.map(relation => relation.id))
  next.openingPhases.forEach(phase => {
    phase.segmentIds = phase.segmentIds.filter(id => validSegments.has(id))
    phase.overriddenSegmentIds = phase.overriddenSegmentIds?.filter(id => validSegments.has(id))
    phase.stationRelationIds = phase.stationRelationIds.filter(id => validRelations.has(id))
    phase.overriddenStationRelationIds = phase.overriddenStationRelationIds?.filter(id => validRelations.has(id))
  })
  next.operationEvents = next.operationEvents?.filter(event => next.lines.some(line => line.id === event.lineId)).map(event => ({
    ...event,
    segmentIds: event.segmentIds.filter(id => validSegments.has(id)),
    stationRelationIds: event.stationRelationIds.filter(id => validRelations.has(id)),
  }))
  void survivingSegmentIds
  return success(next)
}
