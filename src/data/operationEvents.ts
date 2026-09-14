import type { ActualRouteProject, OpeningPhase } from './model'
import { uid } from './model'
import type { OpeningPhasePath } from './openingPhases'

export interface CreateClosureEventInput {
  lineId: string
  name?: string
  closedAt: string
  path: OpeningPhasePath
  revealStartStationId?: string
  revealEndStationId?: string
}

const PREFIX = 'closure-phase_'

/** Closure events reuse the legacy OpeningPhase envelope for JSON compatibility.
 * Their selected segments/relations live in the override-id arrays so legacy
 * opening-phase lookup never mistakes a closure for an opening event.
 */
export function isClosureOperationEvent(phase: OpeningPhase) {
  return phase.id.startsWith(PREFIX)
}

export function getClosureSegmentIds(phase: OpeningPhase) {
  return isClosureOperationEvent(phase) ? phase.overriddenSegmentIds ?? [] : []
}

export function getClosureRelationIds(phase: OpeningPhase) {
  return isClosureOperationEvent(phase) ? phase.overriddenStationRelationIds ?? [] : []
}

export function createClosureEvent(project: ActualRouteProject, input: CreateClosureEventInput): { project: ActualRouteProject; phaseId: string } {
  const next = structuredClone(project)
  const phaseId = uid('closure-phase')
  const selected = new Set(input.path.segmentIds)
  const relationIds = input.path.stationIds.flatMap(stationId => {
    const relation = next.stationLineRelations.find(item => item.stationId === stationId && item.lineId === input.lineId)
    if (!relation || remainsConnected(next, input.lineId, stationId, selected, input.closedAt)) return []
    return [relation.id]
  })
  const phase: OpeningPhase = {
    id: phaseId,
    lineId: input.lineId,
    name: input.name?.trim() || undefined,
    openedAt: input.closedAt,
    segmentIds: [],
    stationRelationIds: [],
    overriddenSegmentIds: [...input.path.segmentIds],
    overriddenStationRelationIds: relationIds,
    revealStartStationId: input.revealStartStationId ?? input.path.stationIds[0],
    revealEndStationId: input.revealEndStationId ?? input.path.stationIds.at(-1),
  }
  next.openingPhases.push(phase)
  for (const segmentId of input.path.segmentIds) {
    const segment = next.geometry.segments.find(item => item.id === segmentId)
    if (segment) segment.closedAt = input.closedAt
  }
  for (const relationId of relationIds) {
    const relation = next.stationLineRelations.find(item => item.id === relationId)
    if (relation) relation.closedAt = input.closedAt
  }
  syncWholeLineClosure(next, phase, undefined)
  return { project: next, phaseId }
}

export function updateClosureEvent(project: ActualRouteProject, phaseId: string, closedAt: string): ActualRouteProject {
  const next = structuredClone(project)
  const phase = next.openingPhases.find(item => item.id === phaseId)
  if (!phase || !isClosureOperationEvent(phase) || !closedAt) return project
  const previousDate = phase.openedAt
  phase.openedAt = closedAt
  for (const segmentId of getClosureSegmentIds(phase)) {
    const segment = next.geometry.segments.find(item => item.id === segmentId)
    if (segment?.closedAt === previousDate) segment.closedAt = closedAt
  }
  for (const relationId of getClosureRelationIds(phase)) {
    const relation = next.stationLineRelations.find(item => item.id === relationId)
    if (relation?.closedAt === previousDate) relation.closedAt = closedAt
  }
  syncWholeLineClosure(next, phase, previousDate)
  return next
}

export function renameClosureEvent(project: ActualRouteProject, phaseId: string, name: string): ActualRouteProject {
  const next = structuredClone(project)
  const phase = next.openingPhases.find(item => item.id === phaseId)
  if (!phase || !isClosureOperationEvent(phase)) return project
  phase.name = name.trim() || undefined
  return next
}

function syncWholeLineClosure(project: ActualRouteProject, phase: OpeningPhase, previousDate: string | undefined) {
  const line = project.lines.find(item => item.id === phase.lineId)
  if (!line) return
  const lineSegmentIds = project.geometry.segments.filter(item => item.lineId === phase.lineId).map(item => item.id)
  const selected = new Set(getClosureSegmentIds(phase))
  if (!lineSegmentIds.length || !lineSegmentIds.every(id => selected.has(id))) return
  if (previousDate === undefined || line.closedAt === previousDate || !line.closedAt) line.closedAt = phase.openedAt
}

function remainsConnected(project: ActualRouteProject, lineId: string, stationId: string, selected: Set<string>, closureDate: string) {
  return project.geometry.segments.some(segment => segment.lineId === lineId && !selected.has(segment.id) && (segment.fromStationId === stationId || segment.toStationId === stationId) && (!segment.openedAt || segment.openedAt <= closureDate) && (!segment.closedAt || closureDate < segment.closedAt))
}
