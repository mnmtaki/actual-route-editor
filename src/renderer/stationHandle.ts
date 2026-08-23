import type { ActualRouteProject } from '../data/model'
import { sampleSegmentNearStation } from '../geometry/path'
import { getOrientationAnchorLine, getActiveLinesAtStation } from '../timeline/active'
import { getStationLineTangent } from '../geometry/tangent'

export function getStationHandleStyle(project: ActualRouteProject, stationId: string, time: string) {
  const station = project.stations.find(item => item.id === stationId)
  const line = getOrientationAnchorLine(project, stationId, time) ?? getActiveLinesAtStation(project, stationId, time)[0]
  if (!station || !line) return { x: station?.x ?? 0, y: station?.y ?? 0, color: '#4f5858' }
  const connected = project.geometry.segments.filter(segment => segment.lineId === line.id && (segment.fromStationId === stationId || segment.toStationId === stationId))
  let direction: { x: number; y: number }
  if (connected.length === 1) {
    const inner = sampleSegmentNearStation(project, connected[0], stationId, .08)
    const dx = station.x - (inner?.x ?? station.x - 1), dy = station.y - (inner?.y ?? station.y)
    const length = Math.hypot(dx, dy) || 1
    direction = { x: dx / length, y: dy / length }
  } else {
    const angle = getStationLineTangent(project, stationId, line.id) * Math.PI / 180
    direction = { x: -Math.sin(angle), y: Math.cos(angle) }
    if (direction.y > 0) direction = { x: -direction.x, y: -direction.y }
  }
  const distance = Math.max(18, project.settings.stationSize / 2 + 12)
  return { x: station.x + direction.x * distance, y: station.y + direction.y * distance, color: line.color }
}

