import type { ActualRouteProject, Segment, Station, Waypoint } from './model'
import { uid } from './model'
import { deleteStationConsistently } from './operationsLegacy'
import { isStationGeometryLocked } from './lineLock'
import { canUseIndependentStationAnchor } from './stationAnchor'

export type StationDeletionResult =
  | { ok: true; project: ActualRouteProject; reconnected: boolean }
  | { ok: false; project: ActualRouteProject; reason: string }

const blocked = (project: ActualRouteProject, reason: string): StationDeletionResult => ({ ok: false, project, reason })
const isBetween = (segment: Segment, a: string, b: string) =>
  (segment.fromStationId === a && segment.toStationId === b) || (segment.fromStationId === b && segment.toStationId === a)

/** The old geometry must not contain stage/style/history information that a new segment would lose. */
function unsafeMetadata(project: ActualRouteProject, station: Station, relations: ActualRouteProject['stationLineRelations'], segments: Segment[]) {
  if (station.source || station.compoundGroupId) return true
  if (project.stations.some(other => other.id !== station.id && station.compoundGroupId && other.compoundGroupId === station.compoundGroupId)) return true
  const segIds = new Set(segments.map(segment => segment.id))
  const relationIds = new Set(relations.map(relation => relation.id))
  if (relations.some(r => (r.operationHistory?.length ?? 0) > 0 || (r.anchor && canUseIndependentStationAnchor(project, station.id)))) return true
  if (segments.some(s => s.source || s.mode === 'rounded' || (s.structureNodes?.length ?? 0) > 0 || (s.lineHistory?.length ?? 0) > 0 || (s.operationHistory?.length ?? 0) > 0 || s.waypoints.some(w => w.source))) return true
  if (project.openingPhases.some(phase =>
    phase.revealStartStationId === station.id || phase.revealEndStationId === station.id ||
    [...phase.segmentIds, ...(phase.overriddenSegmentIds ?? [])].some(id => segIds.has(id)) ||
    [...phase.stationRelationIds, ...(phase.overriddenStationRelationIds ?? [])].some(id => relationIds.has(id)))) return true
  if (project.operationEvents?.some(event =>
    event.segmentIds.some(id => segIds.has(id)) || event.stationRelationIds.some(id => relationIds.has(id)))) return true
  return false
}

function orderedWaypoints(segment: Segment, startStationId: string): Waypoint[] {
  return segment.fromStationId === startStationId
    ? segment.waypoints.map(item => ({ ...item }))
    : [...segment.waypoints].reverse().map(item => ({ ...item }))
}

/**
 * Safely delete one station without silently hiding its surviving neighbors.
 *
 * - A plain middle station is replaced by a track waypoint and its two adjacent
 *   segments become a single segment (preserving straight corners and curve points).
 * - An end/standalone station is deleted, leaving all other station memberships.
 * - Ambiguous or history-bearing geometry is rejected without mutating the project.
 */
export function deleteStationPreservingNetwork(project: ActualRouteProject, stationId: string): StationDeletionResult {
  const station = project.stations.find(s => s.id === stationId)
  if (!station) return blocked(project, '找不到要删除的车站')
  if (isStationGeometryLocked(project, stationId)) return blocked(project, '该车站关联了锁定线路，请先解锁')
  const relations = project.stationLineRelations.filter(r => r.stationId === stationId)
  const segments = project.geometry.segments.filter(s => s.fromStationId === stationId || s.toStationId === stationId)
  if (relations.length > 1 || segments.some(s => relations.length && s.lineId !== relations[0].lineId))
    return blocked(project, '该站属于多条线路或复杂连接，请分别处理线路关系后再删除')
  if (segments.length > 2) return blocked(project, '分叉站连接超过两个区间，无法安全判断该连接哪两个方向')
  if (unsafeMetadata(project, station, relations, segments))
    return blocked(project, '该站关联导入数据、运营历史、开通阶段或特殊样式，不能安全自动重连，请先检查区间')

  if (!segments.length) {
    // Keep the global database consistent; other independent stations survive.
    return { ok: true, project: deleteStationConsistently(project, stationId), reconnected: false }
  }
  if (relations.length !== 1 || segments.some(s => s.lineId !== relations[0].lineId))
    return blocked(project, '站点和区间的线路归属不一致，已取消删除以避免丢失数据')
  const line = project.lines.find(l => l.id === relations[0].lineId)
  if (!line || line.stationSequence.filter(id => id === stationId).length !== 1)
    return blocked(project, '线路站点顺序不明确，无法安全删除该车站')

  const index = line.stationSequence.indexOf(stationId)
  if (segments.length === 1) {
    const neighbor = index === 0 ? line.stationSequence[1] : index === line.stationSequence.length - 1 ? line.stationSequence[index - 1] : null
    if (!neighbor || !isBetween(segments[0], stationId, neighbor))
      return blocked(project, '该站连接方式与站点顺序不一致，请先检查线路')
    return { ok: true, project: deleteStationConsistently(project, stationId), reconnected: false }
  }

  // The stored stationSequence may be stale after branches or ring edits.
  // The two physical incident segments are authoritative for a degree-two station.
  // Do not discard an otherwise safe geometry merge merely because the cached
  // linear sequence does not list both physical neighbors consecutively.
  const [first, second] = segments
  const a = first.fromStationId === stationId ? first.toStationId : first.fromStationId
  const b = second.fromStationId === stationId ? second.toStationId : second.fromStationId
  if (a === b || a === stationId || b === stationId)
    return blocked(project, '相邻站存在重复或闭环关系，无法安全自动重连')
  if (project.geometry.segments.some(s => s.lineId === line.id && isBetween(s, a, b)))
    return blocked(project, '该站附近已存在两邻站的直接区间，无法安全自动重连')
  // Preserve the original segment orientation while ordering the merged chain
  // from a -> station -> b.
  if (first.mode !== second.mode || first.structureType !== second.structureType ||
      first.lineStyleId !== second.lineStyleId || first.openedAt !== second.openedAt ||
      first.closedAt !== second.closedAt || first.cornerRadius !== second.cornerRadius)
    return blocked(project, '两侧区间的样式、结构或时间不同，不能直接合并，否则会丢失信息')

  const straight = first.mode === 'straight'
  const asWaypoints = (segment: Segment, start: string) =>
    orderedWaypoints(segment, start).map(point => straight ? { ...point, type: 'corner' as const } : point)
  const merged: Segment = {
    ...first,
    id: uid('segment'),
    fromStationId: a,
    toStationId: b,
    // In smooth mode, a corner waypoint keeps the old straight polyline exact.
    mode: 'smooth',
    structureNodes: [],
    waypoints: [
      ...asWaypoints(first, a),
      { id: uid('waypoint'), x: station.x, y: station.y, type: straight ? 'corner' : 'smooth' },
      ...asWaypoints(second, stationId),
    ],
  }
  const next = deleteStationConsistently(project, stationId)
  next.geometry.segments.push(merged)
  return { ok: true, project: next, reconnected: true }
}
