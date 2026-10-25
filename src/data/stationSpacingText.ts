import type { ActualRouteProject } from './model'
import { getSegmentDistanceMeters } from './stationSpacing'
import { getActiveNetworkAtTime } from '../timeline/active'
import { getLineDisplayName } from './lineIdentity'
import { isFakeLine } from './fakeLines'

/** Human-readable, clipboard-ready spacing report using true segment geometry. */
export function formatStationSpacingText(project: ActualRouteProject): string {
  const active = getActiveNetworkAtTime(project, project.timeline.currentDate)
  const byLine = new Map<string, string[]>()
  const stations = new Map(project.stations.map(station => [station.id, station]))
  for (const line of active.lines) {
    if (!isFakeLine(line)) byLine.set(line.id, [])
  }
  for (const segment of active.segments) {
    const lines = byLine.get(segment.lineId)
    if (!lines) continue
    const from = stations.get(segment.fromStationId)
    const to = stations.get(segment.toStationId)
    if (!from || !to) continue
    try {
      const metres = getSegmentDistanceMeters(project, segment)
      if (!Number.isFinite(metres) || metres <= 0) continue
      lines.push(`${from.name} — ${to.name}：${Math.round(metres)} 米`)
    } catch {
      // Ignore incomplete imported geometry without losing other distances.
    }
  }
  const chunks = [`${project.name || '未命名工程'} · 站距\n（按当前时间轴日期 ${project.timeline.currentDate}，按线路区间统计）`]
  for (const line of active.lines) {
    const items = byLine.get(line.id)
    if (!items || !items.length) continue
    chunks.push(`【${getLineDisplayName(project, line) || line.name}】\n${items.join('\n')}`)
  }
  return chunks.join('\n\n') + '\n'
}
