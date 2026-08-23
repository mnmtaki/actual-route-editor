import type { ActualRouteProject } from '../data/model'
import { sampleSegmentNearStation } from './path'
import { getOrientationAnchorLine } from '../timeline/active'

export function getStationLineTangent(project: ActualRouteProject, stationId: string, lineId: string): number {
  const station = project.stations.find((item) => item.id === stationId)
  if (!station) return 0
  const connected = project.geometry.segments.filter(
    (segment) => segment.lineId === lineId && (segment.fromStationId === stationId || segment.toStationId === stationId),
  )
  const samples = connected
    .map((segment) => sampleSegmentNearStation(project, segment, stationId))
    .filter((point): point is { x: number; y: number } => Boolean(point))
  if (!samples.length) return 0
  let vector: { x: number; y: number }
  if (samples.length >= 2) {
    vector = { x: samples[1].x - samples[0].x, y: samples[1].y - samples[0].y }
  } else {
    vector = { x: samples[0].x - station.x, y: samples[0].y - station.y }
  }
  let degrees = (Math.atan2(vector.y, vector.x) * 180) / Math.PI
  if (degrees < -90) degrees += 180
  if (degrees >= 90) degrees -= 180
  return degrees
}

export function getTransferMarkerRotation(project: ActualRouteProject, stationId: string, time: string): number {
  const anchor = getOrientationAnchorLine(project, stationId, time)
  return anchor ? getStationLineTangent(project, stationId, anchor.id) : 0
}
