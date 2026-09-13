export * from './operationsLegacy'

import type { ActualRouteProject } from './model'
import { uid } from './model'
import type { Point } from './operationsLegacy'
import {
  appendStationToLine as appendStationToLineLegacy,
  connectExistingStation as connectExistingStationLegacy,
  deleteStationConsistently as deleteStationConsistentlyLegacy,
  insertStationIntoSegment as insertStationIntoSegmentLegacy,
} from './operationsLegacy'
import { findSegmentProgressForPoint } from '../geometry/path'
import { getSegmentStyleIntervalAtProgress } from './structure'

export interface DrawingWaypointPoint extends Point { id?: string }

function applyDrawingWaypoints(project: ActualRouteProject, existingSegmentIds: Set<string>, points: readonly DrawingWaypointPoint[]): string | null {
  const segment = project.geometry.segments.find(item => !existingSegmentIds.has(item.id))
  if (!segment) return null
  segment.waypoints = points.map(point => ({ id: point.id || uid('waypoint'), x: point.x, y: point.y, type: 'smooth' as const }))
  segment.mode = 'smooth'
  return segment.id
}

/**
 * Finish one station-to-station drawing interval while keeping all draft control points
 * inside the Segment that is created by the mature station/topology operation.
 */
export function appendStationToLineWithWaypoints(
  project: ActualRouteProject,
  lineId: string,
  point: Point,
  waypoints: readonly DrawingWaypointPoint[],
  fromStationId?: string | null,
  openingPhaseId?: string,
): { project: ActualRouteProject; stationId: string; segmentId: string | null } {
  const existingSegmentIds = new Set(project.geometry.segments.map(item => item.id))
  const result = appendStationToLineLegacy(project, lineId, point, fromStationId, openingPhaseId)
  const segmentId = applyDrawingWaypoints(result.project, existingSegmentIds, waypoints)
  return { ...result, segmentId }
}

/** Connect the active drawing interval to an existing Station without discarding its control points. */
export function connectExistingStationWithWaypoints(
  project: ActualRouteProject,
  lineId: string,
  stationId: string,
  waypoints: readonly DrawingWaypointPoint[],
  fromStationId?: string | null,
  openingPhaseId?: string,
): { project: ActualRouteProject; segmentId: string | null } {
  const existingSegmentIds = new Set(project.geometry.segments.map(item => item.id))
  const next = connectExistingStationLegacy(project, lineId, stationId, fromStationId, openingPhaseId)
  if (next === project) return { project, segmentId: null }
  return { project: next, segmentId: applyDrawingWaypoints(next, existingSegmentIds, waypoints) }
}

export interface DemoteTerminalStationResult {
  project: ActualRouteProject
  anchorStationId: string
  draftPoints: { id: string; x: number; y: number }[]
}

/**
 * Turn the just-created simple terminal Station back into a drawing control point.
 * This is deliberately conservative: transfers, branches and non-terminal Stations are not demoted.
 */
export function demoteTerminalStationToDrawingPoint(project: ActualRouteProject, lineId: string, stationId: string): DemoteTerminalStationResult | null {
  const line = project.lines.find(item => item.id === lineId)
  const station = project.stations.find(item => item.id === stationId)
  if (!line || !station || line.stationSequence.at(-1) !== stationId) return null
  const relations = project.stationLineRelations.filter(item => item.stationId === stationId)
  if (relations.length !== 1 || relations[0].lineId !== lineId) return null
  const incident = project.geometry.segments.filter(item => item.fromStationId === stationId || item.toStationId === stationId)
  if (incident.length !== 1 || incident[0].lineId !== lineId) return null
  const segment = incident[0]
  const anchorStationId = segment.fromStationId === stationId ? segment.toStationId : segment.fromStationId
  const ordered = segment.toStationId === stationId ? segment.waypoints : [...segment.waypoints].reverse()
  const draftPoints = [
    ...ordered.map(point => ({ id: point.id, x: point.x, y: point.y })),
    { id: uid('waypoint'), x: station.x, y: station.y },
  ]
  return { project: deleteStationConsistentlyLegacy(project, stationId), anchorStationId, draftPoints }
}

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
