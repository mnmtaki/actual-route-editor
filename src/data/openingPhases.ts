import type { ActualRouteProject, OpeningPhase, Segment } from './model'
import { uid } from './model'

export interface OpeningPhasePath { segmentIds: string[]; stationIds: string[] }
export interface CreateOpeningPhaseInput { lineId: string; name?: string; openedAt: string; path?: OpeningPhasePath; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean }

export function getOpeningPhasePathCandidates(project: ActualRouteProject, lineId: string, startStationId: string, endStationId: string): OpeningPhasePath[] {
  if (!startStationId || !endStationId || startStationId === endStationId) return []
  const segments = project.geometry.segments.filter(segment => segment.lineId === lineId)
  const adjacency = new Map<string, Segment[]>()
  for (const segment of segments) for (const stationId of [segment.fromStationId, segment.toStationId]) adjacency.set(stationId, [...(adjacency.get(stationId) ?? []), segment])
  const results: OpeningPhasePath[] = []
  const visit = (stationId: string, stationIds: string[], segmentIds: string[]) => {
    if (results.length >= 16) return
    if (stationId === endStationId) { results.push({ stationIds, segmentIds }); return }
    for (const segment of stableSegments(project, adjacency.get(stationId) ?? [])) {
      if (segmentIds.includes(segment.id)) continue
      const nextId = segment.fromStationId === stationId ? segment.toStationId : segment.fromStationId
      if (stationIds.includes(nextId)) continue
      visit(nextId, [...stationIds, nextId], [...segmentIds, segment.id])
    }
  }
  visit(startStationId, [startStationId], [])
  return results.sort((a, b) => a.segmentIds.length - b.segmentIds.length || a.segmentIds.join().localeCompare(b.segmentIds.join()))
}

export function createOpeningPhase(project: ActualRouteProject, input: CreateOpeningPhaseInput): { project: ActualRouteProject; phaseId: string } {
  const next = structuredClone(project)
  const phaseId = uid('phase')
  const path = input.path ?? { segmentIds: [], stationIds: [] }
  const segmentSet = new Set(path.segmentIds)
  const stationRelationIds = path.stationIds.flatMap(stationId => {
    const relation = next.stationLineRelations.find(item => item.stationId === stationId && item.lineId === input.lineId)
    if (!relation || isExistingConnection(next, input.lineId, stationId, segmentSet, input.openedAt)) return []
    return [relation.id]
  })
  const phase: OpeningPhase = { id: phaseId, lineId: input.lineId, name: input.name?.trim() || undefined, openedAt: input.openedAt, revealStartStationId: input.revealStartStationId ?? path.stationIds[0], revealEndStationId: input.revealEndStationId ?? path.stationIds.at(-1), showOverviewAfter: input.showOverviewAfter === true, segmentIds: [...path.segmentIds], stationRelationIds, overriddenSegmentIds: [], overriddenStationRelationIds: [] }
  next.openingPhases.push(phase)
  synchronizeOpeningPhase(next, phase)
  return { project: next, phaseId }
}

export function updateOpeningPhase(project: ActualRouteProject, phaseId: string, patch: { name?: string; openedAt?: string; showOverviewAfter?: boolean }): ActualRouteProject {
  const next = structuredClone(project)
  const phase = next.openingPhases.find(item => item.id === phaseId)
  if (!phase) return project
  if (patch.name !== undefined) phase.name = patch.name.trim() || undefined
  if (patch.openedAt) phase.openedAt = patch.openedAt
  if (patch.showOverviewAfter !== undefined) phase.showOverviewAfter = patch.showOverviewAfter
  synchronizeOpeningPhase(next, phase)
  return next
}

export function deleteOpeningPhase(project: ActualRouteProject, phaseId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.openingPhases = next.openingPhases.filter(item => item.id !== phaseId)
  return next
}

export function assignCreatedObjectsToPhase(project: ActualRouteProject, phaseId: string | undefined, segmentIds: string[], stationRelationIds: string[]): void {
  if (!phaseId) return
  const phase = project.openingPhases.find(item => item.id === phaseId)
  if (!phase) return
  for (const segmentId of segmentIds) if (!phase.segmentIds.includes(segmentId)) phase.segmentIds.push(segmentId)
  for (const relationId of stationRelationIds) if (!phase.stationRelationIds.includes(relationId)) phase.stationRelationIds.push(relationId)
  synchronizeOpeningPhase(project, phase)
}

export function getOpeningPhaseDate(project: ActualRouteProject, phaseId: string | undefined): string | null {
  return phaseId ? project.openingPhases.find(item => item.id === phaseId)?.openedAt ?? null : null
}

export function markSegmentDateOverride(project: ActualRouteProject, segmentId: string): void {
  for (const phase of project.openingPhases) if (phase.segmentIds.includes(segmentId) && !phase.overriddenSegmentIds?.includes(segmentId)) phase.overriddenSegmentIds = [...(phase.overriddenSegmentIds ?? []), segmentId]
}

export function markRelationDateOverride(project: ActualRouteProject, relationId: string): void {
  for (const phase of project.openingPhases) if (phase.stationRelationIds.includes(relationId) && !phase.overriddenStationRelationIds?.includes(relationId)) phase.overriddenStationRelationIds = [...(phase.overriddenStationRelationIds ?? []), relationId]
}

/** Restores one station's inherited opening date without creating another source of truth. */
export function clearRelationDateOverride(project: ActualRouteProject, relationId: string): void {
  for (const phase of project.openingPhases) {
    if (!phase.stationRelationIds.includes(relationId)) continue
    phase.overriddenStationRelationIds = (phase.overriddenStationRelationIds ?? []).filter(id => id !== relationId)
    const relation = project.stationLineRelations.find(item => item.id === relationId)
    if (relation) relation.openedAt = phase.openedAt
  }
}

export function phaseForSegment(project: ActualRouteProject, segmentId: string) { return project.openingPhases.find(phase => phase.segmentIds.includes(segmentId)) }
export function phaseForRelation(project: ActualRouteProject, relationId: string) { return project.openingPhases.find(phase => phase.stationRelationIds.includes(relationId)) }

function synchronizeOpeningPhase(project: ActualRouteProject, phase: OpeningPhase) {
  const segmentOverrides = new Set(phase.overriddenSegmentIds ?? [])
  const relationOverrides = new Set(phase.overriddenStationRelationIds ?? [])
  for (const segmentId of phase.segmentIds) if (!segmentOverrides.has(segmentId)) { const segment = project.geometry.segments.find(item => item.id === segmentId); if (segment) segment.openedAt = phase.openedAt }
  for (const relationId of phase.stationRelationIds) if (!relationOverrides.has(relationId)) { const relation = project.stationLineRelations.find(item => item.id === relationId); if (relation) relation.openedAt = phase.openedAt }
}

function isExistingConnection(project: ActualRouteProject, lineId: string, stationId: string, selected: Set<string>, phaseDate: string) {
  const relation = project.stationLineRelations.find(item => item.stationId === stationId && item.lineId === lineId)
  if (!relation?.openedAt || relation.openedAt >= phaseDate) return false
  return project.geometry.segments.some(segment => segment.lineId === lineId && !selected.has(segment.id) && (segment.fromStationId === stationId || segment.toStationId === stationId) && Boolean(segment.openedAt && segment.openedAt < phaseDate))
}
function stableSegments(project: ActualRouteProject, segments: Segment[]) {
  const line = segments[0] ? project.lines.find(item => item.id === segments[0].lineId) : undefined
  const index = (stationId: string) => { const value = line?.stationSequence.indexOf(stationId) ?? -1; return value < 0 ? 1e9 : value }
  return [...segments].sort((a, b) => Math.min(index(a.fromStationId), index(a.toStationId)) - Math.min(index(b.fromStationId), index(b.toStationId)) || a.id.localeCompare(b.id))
}
