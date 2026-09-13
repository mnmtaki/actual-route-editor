import type { ActualRouteProject, Segment, StructureNode, StructureType } from '../data/model'
import { uid } from '../data/model'
import { findSegmentProgressForPoint, getSegmentSubpathSpans, pathSpansToSvgPath, reversePathSpans, sampleSegmentAtLengthRatio, type PathSpan, type Point } from '../geometry/path'
import { isSegmentGeometryLocked } from './lineLock'

const EPSILON = 1e-5
export interface StructureInterval { start: number; end: number; structureType: StructureType }
export interface StyleInterval extends StructureInterval { lineStyleId?: string | null; startNodeId?: string }
export interface StyleIntervalState { structureType: StructureType; lineStyleId?: string | null }
export interface StructureVisibility { revealProgress: number; revealFrom: 'from' | 'to'; opacity: number }
export type StructureRunBoundary = 'continuous' | 'structure-transition' | 'line-terminal'
export interface StructureRun { id: string; lineId: string; structureType: 'elevated'; segmentIds: string[]; points: Point[]; spans: PathSpan[]; path: string; opacity: number; startBoundary: StructureRunBoundary; endBoundary: StructureRunBoundary; startTangent: Point; endTangent: Point }
export type WaypointStructureChange = StructureType | 'none'

export function resolveStructureNodeProgress(project: ActualRouteProject, segment: Segment, node: StructureNode): number {
  if (node.waypointId) {
    const waypoint = segment.waypoints.find(item => item.id === node.waypointId)
    if (waypoint) return findSegmentProgressForPoint(project, segment, waypoint)
  }
  return clamp(node.progress ?? 0)
}
function sortedStylePoints(project: ActualRouteProject, segment: Segment) {
  return [...(segment.structureNodes ?? [])]
    .map(node => ({ node, progress: resolveStructureNodeProgress(project, segment, node) }))
    .filter(item => item.progress > EPSILON && item.progress < 1 - EPSILON)
    .sort((a, b) => a.progress - b.progress || a.node.id.localeCompare(b.node.id))
}
function nextLineStyle(current: string | null | undefined, node: StructureNode) {
  return node.styleAfter === undefined ? current : node.styleAfter.lineStyleId
}
export function getSegmentStyleIntervals(project: ActualRouteProject, segment: Segment): StyleInterval[] {
  const nodes = sortedStylePoints(project, segment)
  const intervals: StyleInterval[] = []
  let cursor = 0, structureType = segment.structureType, lineStyleId = segment.lineStyleId, startNodeId: string | undefined
  for (const { node, progress } of nodes) {
    if (progress > cursor + EPSILON) intervals.push({ start: cursor, end: progress, structureType, lineStyleId, ...(startNodeId ? { startNodeId } : {}) })
    structureType = node.structureAfter
    lineStyleId = nextLineStyle(lineStyleId, node)
    cursor = progress
    startNodeId = node.id
  }
  if (cursor < 1 - EPSILON) intervals.push({ start: cursor, end: 1, structureType, lineStyleId, ...(startNodeId ? { startNodeId } : {}) })
  return intervals
}
export function getSegmentStyleIntervalAtProgress(project: ActualRouteProject, segment: Segment, progress: number): StyleInterval {
  const clamped = clamp(progress)
  const intervals = getSegmentStyleIntervals(project, segment)
  return intervals.find(interval => clamped >= interval.start - EPSILON && clamped < interval.end - EPSILON)
    ?? intervals.at(-1)
    ?? { start: 0, end: 1, structureType: segment.structureType, lineStyleId: segment.lineStyleId }
}
export function getSegmentStructureIntervals(project: ActualRouteProject, segment: Segment): StructureInterval[] {
  return getSegmentStyleIntervals(project, segment).map(({ start, end, structureType }) => ({ start, end, structureType }))
}
/** Add a style boundary without changing the rendered result. Both new intervals inherit the style that was active at the insertion point. */
export function addStructureNodeAtProgress(project: ActualRouteProject, segmentId: string, progress: number, _legacyStructureAfter?: StructureType): { project: ActualRouteProject; nodeId: string | null } {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return { project, nodeId: null }
  if (isSegmentGeometryLocked(project, segmentId)) return { project, nodeId: null }
  const at = Math.max(EPSILON, Math.min(1 - EPSILON, progress))
  const existing = sortedStylePoints(next, segment).find(item => Math.abs(item.progress - at) < EPSILON * 4)
  if (existing) return { project, nodeId: existing.node.id }
  const current = getSegmentStyleIntervalAtProgress(next, segment, at)
  const node: StructureNode = {
    id: uid('structure'),
    progress: at,
    structureAfter: current.structureType,
    styleAfter: current.lineStyleId === undefined ? {} : { lineStyleId: current.lineStyleId },
  }
  segment.structureNodes = [...(segment.structureNodes ?? []), node]
  return { project: next, nodeId: node.id }
}
export function updateStyleIntervalAtProgress(project: ActualRouteProject, segmentId: string, progress: number, state: StyleIntervalState): ActualRouteProject {
  if (isSegmentGeometryLocked(project, segmentId)) return project
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return project
  const interval = getSegmentStyleIntervalAtProgress(next, segment, progress)
  if (!interval.startNodeId) {
    segment.structureType = state.structureType
    if (state.lineStyleId === undefined) delete segment.lineStyleId
    else segment.lineStyleId = state.lineStyleId
    return next
  }
  const node = segment.structureNodes?.find(item => item.id === interval.startNodeId)
  if (!node) return project
  node.structureAfter = state.structureType
  node.styleAfter = state.lineStyleId === undefined ? {} : { lineStyleId: state.lineStyleId }
  return next
}
export function styleIntervalStatesAroundPoint(project: ActualRouteProject, segmentId: string, nodeId: string): { before: StyleIntervalState; after: StyleIntervalState } | null {
  const segment = project.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return null
  const ordered = sortedStylePoints(project, segment), index = ordered.findIndex(item => item.node.id === nodeId)
  if (index < 0) return null
  const progress = ordered[index].progress
  const before = getSegmentStyleIntervalAtProgress(project, segment, Math.max(0, progress - EPSILON * 8))
  const after = getSegmentStyleIntervalAtProgress(project, segment, Math.min(1, progress + EPSILON * 8))
  return {
    before: { structureType: before.structureType, lineStyleId: before.lineStyleId },
    after: { structureType: after.structureType, lineStyleId: after.lineStyleId },
  }
}
export function styleIntervalStatesEqual(a: StyleIntervalState, b: StyleIntervalState) {
  return a.structureType === b.structureType && a.lineStyleId === b.lineStyleId
}
export function deleteStylePoint(project: ActualRouteProject, segmentId: string, nodeId: string, keep: 'before' | 'after' = 'before'): ActualRouteProject {
  if (isSegmentGeometryLocked(project, segmentId)) return project
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return project
  const ordered = sortedStylePoints(next, segment), index = ordered.findIndex(item => item.node.id === nodeId)
  if (index < 0) return project
  const states = styleIntervalStatesAroundPoint(next, segmentId, nodeId)
  if (!states) return project
  if (keep === 'after') {
    const previous = index > 0 ? ordered[index - 1].node : null
    if (previous) {
      previous.structureAfter = states.after.structureType
      previous.styleAfter = states.after.lineStyleId === undefined ? {} : { lineStyleId: states.after.lineStyleId }
    } else {
      segment.structureType = states.after.structureType
      if (states.after.lineStyleId === undefined) delete segment.lineStyleId
      else segment.lineStyleId = states.after.lineStyleId
    }
  }
  segment.structureNodes = (segment.structureNodes ?? []).filter(node => node.id !== nodeId)
  return next
}
export function setWaypointStructureAfter(project: ActualRouteProject, segmentId: string, waypointId: string, change: WaypointStructureChange | null): ActualRouteProject {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return project
  if (isSegmentGeometryLocked(project, segmentId)) return project
  if (!segment.waypoints.some(waypoint => waypoint.id === waypointId)) return project
  segment.structureNodes = segment.structureNodes ?? []
  const existingIndex = segment.structureNodes.findIndex(node => node.waypointId === waypointId)
  const structureAfter = change === 'none' || change === null ? null : change
  if (structureAfter === null) {
    segment.structureNodes = segment.structureNodes.filter(node => node.waypointId !== waypointId)
  } else if (existingIndex >= 0) {
    const existing = segment.structureNodes[existingIndex]
    existing.structureAfter = structureAfter
    delete existing.progress
    segment.structureNodes = segment.structureNodes.filter((node, index) => index === existingIndex || node.waypointId !== waypointId)
  } else {
    segment.structureNodes.push({ id: uid('structure'), waypointId, structureAfter })
  }
  return next
}
export function updateStructureNode(project: ActualRouteProject, segmentId: string, nodeId: string, structureAfter: StructureType): ActualRouteProject {
  if (isSegmentGeometryLocked(project, segmentId)) return project
  const next = structuredClone(project), node = next.geometry.segments.find(item => item.id === segmentId)?.structureNodes?.find(item => item.id === nodeId)
  if (!node) return project
  node.structureAfter = structureAfter; return next
}
export function moveIndependentStructureNode(project: ActualRouteProject, segmentId: string, nodeId: string, point: Point): ActualRouteProject {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId), node = segment?.structureNodes?.find(item => item.id === nodeId)
  if (!segment || !node || node.waypointId) return project
  if (isSegmentGeometryLocked(project, segmentId)) return project
  node.progress = findSegmentProgressForPoint(next, segment, point)
  return next
}
export function deleteStructureNode(project: ActualRouteProject, segmentId: string, nodeId: string): ActualRouteProject {
  return deleteStylePoint(project, segmentId, nodeId, 'before')
}
export function getStructureNodePoint(project: ActualRouteProject, segment: Segment, node: StructureNode) { return sampleSegmentAtLengthRatio(project, segment, resolveStructureNodeProgress(project, segment, node))?.point ?? null }
export function getWaypointStructureAfter(segment: Segment, waypointId: string) { return segment.structureNodes?.find(node => node.waypointId === waypointId)?.structureAfter ?? null }
export function getWaypointStructureChange(segment: Segment, waypointId: string): WaypointStructureChange { return getWaypointStructureAfter(segment, waypointId) ?? 'none' }

export function splitSegmentStructure(project: ActualRouteProject, segment: Segment, splitProgress: number, beforeWaypointIds: Set<string>, afterWaypointIds: Set<string>): { beforeType: StructureType; beforeLineStyleId?: string | null; beforeNodes: StructureNode[]; afterType: StructureType; afterLineStyleId?: string | null; afterNodes: StructureNode[] } {
  const split = Math.max(EPSILON, Math.min(1 - EPSILON, splitProgress))
  const resolved = sortedStylePoints(project, segment)
  const atSplit = getSegmentStyleIntervalAtProgress(project, segment, Math.min(1, split + EPSILON * 2))
  const mapNode = (item: { node: StructureNode; progress: number }, side: 'before' | 'after'): StructureNode => {
    const waypointIds = side === 'before' ? beforeWaypointIds : afterWaypointIds
    const waypointId = item.node.waypointId && waypointIds.has(item.node.waypointId) ? item.node.waypointId : undefined
    const progress = side === 'before' ? item.progress / split : (item.progress - split) / (1 - split)
    return { ...item.node, waypointId, progress: waypointId ? undefined : clamp(progress) }
  }
  return {
    beforeType: segment.structureType,
    beforeLineStyleId: segment.lineStyleId,
    beforeNodes: resolved.filter(item => item.progress < split - EPSILON).map(item => mapNode(item, 'before')),
    afterType: atSplit.structureType,
    afterLineStyleId: atSplit.lineStyleId,
    afterNodes: resolved.filter(item => item.progress > split + EPSILON).map(item => mapNode(item, 'after')),
  }
}
export function compileElevatedRuns(project: ActualRouteProject, allowedSegmentIds?: Set<string>, visibility?: Record<string, StructureVisibility>): StructureRun[] {
  const fragments: Fragment[] = []
  const degree = new Map<string, number>()
  for (const segment of project.geometry.segments) {
    degree.set(`${segment.lineId}:${segment.fromStationId}`, (degree.get(`${segment.lineId}:${segment.fromStationId}`) ?? 0) + 1)
    degree.set(`${segment.lineId}:${segment.toStationId}`, (degree.get(`${segment.lineId}:${segment.toStationId}`) ?? 0) + 1)
  }
  const stationBoundary = (lineId: string, stationId: string): StructureRunBoundary => degree.get(`${lineId}:${stationId}`) === 1 ? 'line-terminal' : 'structure-transition'
  for (const segment of project.geometry.segments) {
    if (allowedSegmentIds && !allowedSegmentIds.has(segment.id)) continue
    const state = visibility?.[segment.id] ?? { revealProgress: 1, revealFrom: 'from' as const, opacity: 1 }
    if (state.opacity <= 0 || state.revealProgress <= 0) continue
    for (const interval of getSegmentStructureIntervals(project, segment)) {
      if (interval.structureType !== 'elevated') continue
      let start = interval.start, end = interval.end
      if (state.revealProgress < 1) {
        if (state.revealFrom === 'from') end = Math.min(end, state.revealProgress)
        else start = Math.max(start, 1 - state.revealProgress)
      }
      if (end - start <= EPSILON) continue
      const spans = getSegmentSubpathSpans(project, segment, start, end)
      if (!spans.length) continue
      const clippedStart = start > interval.start + EPSILON, clippedEnd = end < interval.end - EPSILON
      const startBoundary: StructureRunBoundary = clippedStart ? 'continuous' : start <= EPSILON ? stationBoundary(segment.lineId, segment.fromStationId) : 'structure-transition'
      const endBoundary: StructureRunBoundary = clippedEnd ? 'continuous' : end >= 1 - EPSILON ? stationBoundary(segment.lineId, segment.toStationId) : 'structure-transition'
      fragments.push({ id: `${segment.id}:${start.toFixed(6)}:${end.toFixed(6)}`, lineId: segment.lineId, segmentId: segment.id, startKey: start <= EPSILON ? `station:${segment.fromStationId}` : `node:${segment.id}:${start.toFixed(6)}`, endKey: end >= 1 - EPSILON ? `station:${segment.toStationId}` : `node:${segment.id}:${end.toFixed(6)}`, spans, opacity: state.opacity, startBoundary, endBoundary })
    }
  }
  const runs: StructureRun[] = []
  for (const lineId of [...new Set(fragments.map(fragment => fragment.lineId))]) {
    const lineFragments = fragments.filter(fragment => fragment.lineId === lineId)
    const adjacency = new Map<string, number[]>()
    lineFragments.forEach((fragment, index) => { adjacency.set(fragment.startKey, [...(adjacency.get(fragment.startKey) ?? []), index]); adjacency.set(fragment.endKey, [...(adjacency.get(fragment.endKey) ?? []), index]) })
    const unused = new Set(lineFragments.map((_, index) => index))
    while (unused.size) {
      const firstIndex = [...unused].sort((a, b) => lineFragments[a].id.localeCompare(lineFragments[b].id))[0], first = lineFragments[firstIndex]
      const startAtEnd = (adjacency.get(first.startKey)?.length ?? 0) === 2 && (adjacency.get(first.endKey)?.length ?? 0) !== 2
      let currentKey = startAtEnd ? first.endKey : first.startKey, currentIndex = firstIndex
      const spans: PathSpan[] = [], segmentIds: string[] = []; let opacity = 1, startBoundary: StructureRunBoundary = 'continuous', endBoundary: StructureRunBoundary = 'continuous', firstFragment = true
      while (unused.has(currentIndex)) {
        unused.delete(currentIndex)
        const fragment = lineFragments[currentIndex], forward = fragment.startKey === currentKey, oriented = forward ? fragment.spans : reversePathSpans(fragment.spans)
        if (firstFragment) { startBoundary = forward ? fragment.startBoundary : fragment.endBoundary; firstFragment = false }
        endBoundary = forward ? fragment.endBoundary : fragment.startBoundary
        spans.push(...oriented); if (!segmentIds.includes(fragment.segmentId)) segmentIds.push(fragment.segmentId); opacity = Math.min(opacity, fragment.opacity)
        const nextKey = forward ? fragment.endKey : fragment.startKey
        const candidates = (adjacency.get(nextKey) ?? []).filter(index => unused.has(index) && Math.abs(lineFragments[index].opacity - fragment.opacity) < .001)
        if ((adjacency.get(nextKey)?.length ?? 0) !== 2 || candidates.length !== 1) break
        currentKey = nextKey; currentIndex = candidates[0]
      }
      if (spans.length) {
        const points = [spans[0].start, ...spans.map(span => span.end)]
        runs.push({ id: `elevated-run-${lineId}-${runs.length}`, lineId, structureType: 'elevated', segmentIds, points, spans, path: pathSpansToSvgPath(spans), opacity, startBoundary, endBoundary, startTangent: spanTangent(spans[0], 'start'), endTangent: spanTangent(spans.at(-1)!, 'end') })
      }
    }
  }
  return runs
}
interface Fragment { id: string; lineId: string; segmentId: string; startKey: string; endKey: string; spans: PathSpan[]; opacity: number; startBoundary: StructureRunBoundary; endBoundary: StructureRunBoundary }
function spanTangent(span: PathSpan, at: 'start' | 'end'): Point {
  const value = at === 'start' ? { x: span.control1.x - span.start.x, y: span.control1.y - span.start.y } : { x: span.end.x - span.control2.x, y: span.end.y - span.control2.y }
  const fallback = { x: span.end.x - span.start.x, y: span.end.y - span.start.y }, length = Math.hypot(value.x, value.y), use = length > EPSILON ? value : fallback, useLength = Math.hypot(use.x, use.y) || 1
  return { x: use.x / useLength, y: use.y / useLength }
}
const clamp = (value: number) => Math.max(0, Math.min(1, value))
