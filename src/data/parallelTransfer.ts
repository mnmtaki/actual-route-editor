import type { ActualRouteProject } from './model'
import { getCompoundStationMembers } from './compoundStation'
import { isStationGeometryLocked } from './lineLock'
import { canUseIndependentStationAnchor } from './stationAnchor'

export interface ParallelTransferOptions {
  lineIds: string[]
  spacing: number
  centerDx: number
  centerDy: number
}

/**
 * Locally align the per-line station occurrences on a common cross-section.
 * Only the participating service anchors and (optionally) the station centre
 * move; existing segments and waypoints remain untouched.
 */
export function adaptParallelTransfer(project: ActualRouteProject, stationId: string, options: ParallelTransferOptions): ActualRouteProject {
  if (!canUseIndependentStationAnchor(project, stationId)) throw new Error('普通站不允许设置独立线路锚点')
  const members = getCompoundStationMembers(project, stationId)
  const memberIds = new Set(members.map(member => member.id))
  const selected = [...new Set(options.lineIds)]
  if (selected.length < 2) throw new Error('至少选择两条需要平行适配的线路')
  if (!Number.isFinite(options.spacing) || options.spacing < 0 || options.spacing > 200) throw new Error('线路间距必须在 0 到 200 之间')
  if (![options.centerDx, options.centerDy].every(Number.isFinite)) throw new Error('站点中心偏移无效')
  const next = structuredClone(project)
  const targetMembers = getCompoundStationMembers(next, stationId)
  if (targetMembers.some(member => isStationGeometryLocked(next, member.id))) throw new Error('换乘站存在锁定线路，请先解锁')
  const involved = selected.map(lineId => {
    const relations = next.stationLineRelations.filter(relation => memberIds.has(relation.stationId) && relation.lineId === lineId)
    if (relations.length !== 1) throw new Error('选中的线路缺少唯一的站点关系，无法适配')
    const relation = relations[0]
    const station = next.stations.find(item => item.id === relation.stationId)!
    const incident = next.geometry.segments.filter(segment => segment.lineId === lineId && (segment.fromStationId === station.id || segment.toStationId === station.id))
    if (incident.length !== 2) throw new Error('参与适配的线路必须在该站恰好连接两个区间')
    if (incident.some(segment => segment.mode === 'rounded')) throw new Error('圆角模式区间暂不支持自动适配')
    return { lineId, relation, station, incident }
  })
  // Use the first line's through-axis as a stable reference. This avoids
  // opposing stored segment orientations cancelling one another.
  const primary = involved[0]
  const otherEndpoints = primary.incident.map(segment => {
    const id = segment.fromStationId === primary.station.id ? segment.toStationId : segment.fromStationId
    return next.stations.find(station => station.id === id)
  })
  if (otherEndpoints.some(item => !item)) throw new Error('相邻区间引用了不存在的车站')
  const dx = otherEndpoints[1]!.x - otherEndpoints[0]!.x
  const dy = otherEndpoints[1]!.y - otherEndpoints[0]!.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) throw new Error('无法确定平行方向，请先调整相邻站位置')
  const normal = { x: -dy / length, y: dx / length }
  const pivot = next.stations.find(station => station.id === stationId)!
  const center = { x: pivot.x + options.centerDx, y: pivot.y + options.centerDy }
  // Preserve each participating line's original side/order, when possible.
  const ranked = involved.map(item => ({
    ...item,
    lateral: (item.relation.anchor?.x ?? item.station.x) * normal.x + (item.relation.anchor?.y ?? item.station.y) * normal.y,
  })).sort((a, b) => a.lateral - b.lateral || a.lineId.localeCompare(b.lineId))
  for (const member of targetMembers) {
    member.x += options.centerDx
    member.y += options.centerDy
  }
  ranked.forEach((item, index) => {
    const lateral = (index - (ranked.length - 1) / 2) * options.spacing
    item.relation.anchor = { x: center.x + normal.x * lateral, y: center.y + normal.y * lateral }
  })
  return next
}
