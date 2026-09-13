export * from './operationsLegacy'

import type { ActualRouteProject } from './model'
import type { Point } from './operationsLegacy'
import { insertStationIntoSegment as insertStationIntoSegmentLegacy } from './operationsLegacy'
import { findSegmentProgressForPoint } from '../geometry/path'
import { getSegmentStyleIntervalAtProgress } from './structure'

/** Preserve the active style interval when a new station turns an internal style boundary into a natural station boundary. */
export function insertStationIntoSegment(project: ActualRouteProject, segmentId: string, point: Point): { project: ActualRouteProject; stationId: string | null } {
  const source = project.geometry.segments.find(item => item.id === segmentId)
  if (!source) return insertStationIntoSegmentLegacy(project, segmentId, point)
  const splitProgress = findSegmentProgressForPoint(project, source, point)
  const afterState = getSegmentStyleIntervalAtProgress(project, source, Math.min(1, splitProgress + 2e-5))
  const result = insertStationIntoSegmentLegacy(project, segmentId, point)
  if (!result.stationId) return result
  const first = result.project.geometry.segments.find(item => item.fromStationId === source.fromStationId && item.toStationId === result.stationId && item.lineId === source.lineId)
  const second = result.project.geometry.segments.find(item => item.fromStationId === result.stationId && item.toStationId === source.toStationId && item.lineId === source.lineId)
  if (first) {
    if (source.lineStyleId === undefined) delete first.lineStyleId
    else first.lineStyleId = source.lineStyleId
  }
  if (second) {
    if (afterState.lineStyleId === undefined) delete second.lineStyleId
    else second.lineStyleId = afterState.lineStyleId
  }
  return result
}
