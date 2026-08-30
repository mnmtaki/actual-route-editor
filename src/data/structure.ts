import type { ActualRouteProject, Segment, StructureNode, StructureType } from '../data/model'
import { uid } from '../data/model'
import { findSegmentProgressForPoint, getSegmentSubpathSpans, pathSpansToSvgPath, reversePathSpans, sampleSegmentAtLengthRatio, type PathSpan, type Point } from '../geometry/path'

const EPSILON = 1e-5
export interface StructureInterval { start: number; end: number; structureType: StructureType }
export interface StructureVisibility { revealProgress: number; revealFrom: 'from' | 'to'; opacity: number }
export type StructureRunBoundary = 'continuous' | 'structure-transition' | 'line-terminal'
export interface StructureRun { id: string; lineId: string; structureType: 'elevated'; segmentIds: string[]; points: Point[]; spans: PathSpan[]; path: string; opacity: number; startBoundary: StructureRunBoundary; endBoundary: StructureRunBoundary; startTangent: Point; endTangent: Point }

export function resolveStructureNodeProgress(project: ActualRouteProject, segment: Segment, node: StructureNode): number {
  if (node.waypointId) {
    const waypoint = segment.waypoints.find(item => item.id === node.waypointId)
    if (waypoint) return findSegmentProgressForPoint(project, segment, waypoint)
  }
  return clamp(node.progress ?? 0)
}
export function getSegmentStructureIntervals(project: ActualRouteProject, segment: Segment): StructureInterval[] {
  const nodes = [...(segment.structureNodes ?? [])].map(node => ({ node, progress: resolveStructureNodeProgress(project, segment, node) })).filter(item => item.progress > EPSILON && item.progress < 1 - EPSILON).sort((a, b) => a.progress - b.progress || a.node.id.localeCompare(b.node.id))
  const intervals: StructureInterval[] = []; let cursor = 0, current = segment.structureType
  for (const { node, progress } of nodes) { if (progress > cursor + EPSILON) intervals.push({ start: cursor, end: progress, structureType: current }); current = node.structureAfter; cursor = progress }
  if (cursor < 1 - EPSILON) intervals.push({ start: cursor, end: 1, structureType: current })
  return intervals
}
export function addStructureNodeAtProgress(project: ActualRouteProject, segmentId: string, progress: number, structureAfter: StructureType): { project: ActualRouteProject; nodeId: string | null } {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return { project, nodeId: null }
  const node: StructureNode = { id: uid('structure'), progress: clamp(progress), structureAfter }
  segment.structureNodes = [...(segment.structureNodes ?? []), node]
  return { project: next, nodeId: node.id }
}
export function setWaypointStructureAfter(project: ActualRouteProject, segmentId: string, waypointId: string, structureAfter: StructureType | null): ActualRouteProject {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return project
  segment.structureNodes = segment.structureNodes ?? []
  const existing = segment.structureNodes.find(node => node.waypointId === waypointId)
  if (!structureAfter) segment.structureNodes = segment.structureNodes.filter(node => node.waypointId !== waypointId)
  else if (existing) existing.structureAfter = structureAfter
  else segment.structureNodes.push({ id: uid('structure'), waypointId, structureAfter })
  return next
}
export function updateStructureNode(project: ActualRouteProject, segmentId: string, nodeId: string, structureAfter: StructureType): ActualRouteProject {
  const next = structuredClone(project), node = next.geometry.segments.find(item => item.id === segmentId)?.structureNodes?.find(item => item.id === nodeId)
  if (!node) return project
  node.structureAfter = structureAfter; return next
}
export function moveIndependentStructureNode(project: ActualRouteProject, segmentId: string, nodeId: string, point: Point): ActualRouteProject {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId), node = segment?.structureNodes?.find(item => item.id === nodeId)
  if (!segment || !node || node.waypointId) return project
  node.progress = findSegmentProgressForPoint(next, segment, point)
  return next
}
export function deleteStructureNode(project: ActualRouteProject, segmentId: string, nodeId: string): ActualRouteProject {
  const next = structuredClone(project), segment = next.geometry.segments.find(item => item.id === segmentId)
  if (!segment) return project
  segment.structureNodes = (segment.structureNodes ?? []).filter(node => node.id !== nodeId); return next
}
export function getStructureNodePoint(project: ActualRouteProject, segment: Segment, node: StructureNode) { return sampleSegmentAtLengthRatio(project, segment, resolveStructureNodeProgress(project, segment, node))?.point ?? null }
export function getWaypointStructureAfter(segment: Segment, waypointId: string) { return segment.structureNodes?.find(node => node.waypointId === waypointId)?.structureAfter ?? null }

export function splitSegmentStructure(project: ActualRouteProject, segment: Segment, splitProgress: number, beforeWaypointIds: Set<string>, afterWaypointIds: Set<string>): { beforeType: StructureType; beforeNodes: StructureNode[]; afterType: StructureType; afterNodes: StructureNode[] } {
  const split = Math.max(EPSILON, Math.min(1 - EPSILON, splitProgress))
  const resolved = (segment.structureNodes ?? []).map(node => ({ node, progress: resolveStructureNodeProgress(project, segment, node) })).sort((a, b) => a.progress - b.progress || a.node.id.localeCompare(b.node.id))
  let afterType = segment.structureType
  for (const item of resolved) if (item.progress <= split + EPSILON) afterType = item.node.structureAfter
  const mapNode = (item: { node: StructureNode; progress: number }, side: 'before' | 'after'): StructureNode => {
    const waypointIds = side === 'before' ? beforeWaypointIds : afterWaypointIds
    const waypointId = item.node.waypointId && waypointIds.has(item.node.waypointId) ? item.node.waypointId : undefined
    const progress = side === 'before' ? item.progress / split : (item.progress - split) / (1 - split)
    return { ...item.node, waypointId, progress: waypointId ? undefined : clamp(progress) }
  }
  return {
    beforeType: segment.structureType,
    beforeNodes: resolved.filter(item => item.progress < split - EPSILON).map(item => mapNode(item, 'before')),
    afterType,
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