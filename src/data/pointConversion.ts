import type { ActualRouteProject, Segment, Selection } from './model'
import { uid } from './model'
import { labelOffsetFor } from './style'
import { isSegmentGeometryLocked } from './lineLock'
import { deleteStationPreservingNetwork } from './stationDeletion'

export type PointConversionResult =
  | { ok: true; project: ActualRouteProject; selection: Exclude<Selection, null> }
  | { ok: false; project: ActualRouteProject; reason: string }

function reject(project: ActualRouteProject, reason: string): PointConversionResult {
  return { ok: false, project, reason }
}

/**
 * Splitting a segment must never silently lose opening-phase references,
 * operation histories, structure/style boundaries or imported AARC identity.
 */
function canSafelySplitSegment(project: ActualRouteProject, segment: Segment, waypointId: string): string | null {
  const line = project.lines.find(item => item.id === segment.lineId)
  if (!line) return '控制点所属线路不存在'
  if (isSegmentGeometryLocked(project, segment.id)) return '线路已锁定，请先解锁'
  if (line.source?.format === 'aarc' || segment.source || segment.waypoints.some(point => point.source))
    return 'AARC 导入对象暂不支持无损切换，请先使用普通原生线路'
  if (segment.lineHistory?.length || segment.operationHistory?.length ||
      segment.mode === 'rounded' || segment.structureNodes?.length)
    return '该区间包含线路历史、圆角或样式分界，无法安全转换控制点'
  if (project.openingPhases.some(phase =>
    phase.segmentIds.includes(segment.id) || phase.overriddenSegmentIds?.includes(segment.id)) ||
    project.operationEvents?.some(event => event.segmentIds.includes(segment.id)))
    return '该区间被开通阶段或运营事件引用，不能安全拆分'
  if (project.geometry.segments.some(other =>
    other.id !== segment.id && other.waypoints.some(point => point.id === waypointId)))
    return '控制点标识在多个区间中重复，无法安全转换'
  const fromIndex = line.stationSequence.indexOf(segment.fromStationId)
  const toIndex = line.stationSequence.indexOf(segment.toStationId)
  if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1 ||
      line.stationSequence.lastIndexOf(segment.fromStationId) !== fromIndex ||
      line.stationSequence.lastIndexOf(segment.toStationId) !== toIndex)
    return '该线路区间不属于明确的相邻两站，无法安全转换'
  return null
}

/** Convert an existing committed control point to a Station in exactly one project edit. */
export function convertWaypointToStation(project: ActualRouteProject, segmentId: string, waypointId: string): PointConversionResult {
  const segment = project.geometry.segments.find(item => item.id === segmentId)
  const index = segment?.waypoints.findIndex(point => point.id === waypointId) ?? -1
  if (!segment || index < 0) return reject(project, '找不到所选控制点')
  const reason = canSafelySplitSegment(project, segment, waypointId)
  if (reason) return reject(project, reason)

  const next = structuredClone(project)
  const target = next.geometry.segments.find(item => item.id === segmentId)!
  const line = next.lines.find(item => item.id === segment.lineId)!
  const waypoint = target.waypoints[index]
  const stationId = uid('station')
  const offset = labelOffsetFor(next.settings.defaultLabelDirection, next.settings.defaultLabelDistance)
  next.stations.push({
    id: stationId, name: `新车站 ${next.stations.length + 1}`,
    x: waypoint.x, y: waypoint.y, labelOffsetX: offset.x, labelOffsetY: offset.y,
  })
  const relationId = uid('relation')
  const openedAt = target.openedAt ?? line.openedAt ?? next.timeline.currentDate ?? null
  next.stationLineRelations.push({
    id: relationId, stationId, lineId: line.id, openedAt, closedAt: target.closedAt ?? null,
  })
  const fromIndex = line.stationSequence.indexOf(target.fromStationId)
  const toIndex = line.stationSequence.indexOf(target.toStationId)
  line.stationSequence.splice(Math.min(fromIndex, toIndex) + 1, 0, stationId)

  const before: Segment = {
    ...target, id: uid('segment'), toStationId: stationId,
    waypoints: target.waypoints.slice(0, index),
  }
  const after: Segment = {
    ...target, id: uid('segment'), fromStationId: stationId,
    waypoints: target.waypoints.slice(index + 1),
  }
  next.geometry.segments.splice(next.geometry.segments.indexOf(target), 1, before, after)
  return { ok: true, project: next, selection: { type: 'station', id: stationId } }
}

/**
 * A station can become a control point only where the safe middle-station
 * deletion operation can preserve the two adjacent segments. It is NOT
 * equivalent to deleting an endpoint, interchange or junction.
 */
export function convertStationToWaypoint(project: ActualRouteProject, stationId: string): PointConversionResult {
  const station = project.stations.find(item => item.id === stationId)
  if (!station) return reject(project, '找不到所选车站')
  const previousWaypointIds = new Set(project.geometry.segments.flatMap(segment => segment.waypoints.map(point => point.id)))
  const previousSegmentIds = new Set(project.geometry.segments.map(segment => segment.id))
  const result = deleteStationPreservingNetwork(project, stationId)
  if (!result.ok) return reject(project, result.reason)
  if (!result.reconnected)
    return reject(project, '只有普通中间站可以切换为控制点；终点站或孤立站无法保持两侧线路')

  const merged = result.project.geometry.segments.find(segment => !previousSegmentIds.has(segment.id))
  const converted = merged?.waypoints.find(point => !previousWaypointIds.has(point.id) &&
    point.x === station.x && point.y === station.y)
  if (!merged || !converted) return reject(project, '转换后的线路控制点无法确认，操作已取消')
  return {
    ok: true, project: result.project,
    selection: { type: 'waypoint', segmentId: merged.id, id: converted.id },
  }
}
