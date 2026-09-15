import type { ActualRouteProject, Line, OperationEvent, OperationHistoryEntry, OperationState, Segment, StationLineRelation } from './model'
import { uid } from './model'
import type { OpeningPhasePath } from './openingPhases'

export interface CreateOperationEventInput {
  lineId: string
  name?: string
  effectiveAt: string
  state: OperationState
  path: OpeningPhasePath
}

export function resolveOperationState(openedAt: string | null | undefined, closedAt: string | null | undefined, history: OperationHistoryEntry[] | undefined, time: string) {
  const entries: Array<{ effectiveAt: string; state: OperationState; order: number }> = []
  if (openedAt) entries.push({ effectiveAt: openedAt, state: 'open', order: 0 })
  if (closedAt) entries.push({ effectiveAt: closedAt, state: 'closed', order: 1 })
  for (const entry of history ?? []) if (validDate(entry.effectiveAt)) entries.push({ effectiveAt: entry.effectiveAt, state: entry.state, order: entry.state === 'closed' ? 1 : 0 })
  if (!entries.length) return true
  entries.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.order - b.order)
  let active = openedAt ? false : entries[0].state === 'closed'
  for (const entry of entries) {
    if (entry.effectiveAt > time) break
    active = entry.state === 'open'
  }
  return active
}

export function isLineOperationalAt(line: Line | undefined, time: string) { return Boolean(line && resolveOperationState(line.openedAt, line.closedAt, line.operationHistory, time)) }
export function isRelationOperationalAt(relation: StationLineRelation | undefined, time: string) { return Boolean(relation && resolveOperationState(relation.openedAt, relation.closedAt, relation.operationHistory, time)) }
export function isSegmentOperationalAt(segment: Segment | undefined, time: string) { return Boolean(segment && resolveOperationState(segment.openedAt, segment.closedAt, segment.operationHistory, time)) }

export function createOperationEvent(project: ActualRouteProject, input: CreateOperationEventInput): { project: ActualRouteProject; eventId: string } {
  const next = structuredClone(project)
  const eventId = uid('operation-event')
  const segmentIds = [...new Set(input.path.segmentIds)]
  const selected = new Set(segmentIds)
  const beforeDate = previousDate(input.effectiveAt)
  const stationRelationIds = [...new Set(input.path.stationIds.flatMap(stationId => {
    const relation = next.stationLineRelations.find(item => item.stationId === stationId && item.lineId === input.lineId)
    if (!relation) return []
    if (input.state === 'open') return isRelationOperationalAt(relation, beforeDate) ? [] : [relation.id]
    return remainsConnected(next, input.lineId, stationId, selected, input.effectiveAt) ? [] : [relation.id]
  }))]
  const allLineSegmentIds = next.geometry.segments.filter(segment => segment.lineId === input.lineId).map(segment => segment.id)
  const affectsLine = input.state === 'open' || (allLineSegmentIds.length > 0 && allLineSegmentIds.every(id => selected.has(id)))
  const event: OperationEvent = { id: eventId, lineId: input.lineId, name: input.name?.trim() || undefined, effectiveAt: input.effectiveAt, state: input.state, segmentIds, stationRelationIds, ...(affectsLine ? { affectsLine: true } : {}) }
  next.operationEvents = [...(next.operationEvents ?? []), event]
  for (const segmentId of segmentIds) addHistory(next.geometry.segments.find(item => item.id === segmentId), event)
  for (const relationId of stationRelationIds) addHistory(next.stationLineRelations.find(item => item.id === relationId), event)
  if (affectsLine) addHistory(next.lines.find(item => item.id === input.lineId), event)
  return { project: next, eventId }
}

export function updateOperationEvent(project: ActualRouteProject, eventId: string, patch: { name?: string; effectiveAt?: string }): ActualRouteProject {
  const next = structuredClone(project)
  const event = next.operationEvents?.find(item => item.id === eventId)
  if (!event) return project
  if (patch.name !== undefined) event.name = patch.name.trim() || undefined
  if (patch.effectiveAt && validDate(patch.effectiveAt)) {
    event.effectiveAt = patch.effectiveAt
    for (const target of [...next.lines, ...next.stationLineRelations, ...next.geometry.segments]) for (const entry of target.operationHistory ?? []) if (entry.eventId === eventId) entry.effectiveAt = patch.effectiveAt
  }
  return next
}

export function deleteOperationEvent(project: ActualRouteProject, eventId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.operationEvents = (next.operationEvents ?? []).filter(item => item.id !== eventId)
  for (const target of [...next.lines, ...next.stationLineRelations, ...next.geometry.segments]) if (target.operationHistory) {
    target.operationHistory = target.operationHistory.filter(entry => entry.eventId !== eventId)
    if (!target.operationHistory.length) delete target.operationHistory
  }
  if (!next.operationEvents.length) delete next.operationEvents
  return next
}

export function normalizeOperationEvents(raw: unknown): OperationEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result = raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<OperationEvent>
    if (typeof item.id !== 'string' || typeof item.lineId !== 'string' || !validDate(item.effectiveAt) || (item.state !== 'open' && item.state !== 'closed')) return []
    return [{ id: item.id, lineId: item.lineId, ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.trim() } : {}), effectiveAt: item.effectiveAt!, state: item.state, segmentIds: Array.isArray(item.segmentIds) ? item.segmentIds.map(String) : [], stationRelationIds: Array.isArray(item.stationRelationIds) ? item.stationRelationIds.map(String) : [], ...(item.affectsLine === true ? { affectsLine: true } : {}) }]
  })
  return result.length ? result : undefined
}

export function normalizeOperationHistory(raw: unknown): OperationHistoryEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result = raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<OperationHistoryEntry>
    if (typeof item.id !== 'string' || !validDate(item.effectiveAt) || (item.state !== 'open' && item.state !== 'closed')) return []
    return [{ id: item.id, effectiveAt: item.effectiveAt!, state: item.state, ...(typeof item.eventId === 'string' && item.eventId ? { eventId: item.eventId } : {}) }]
  }).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || (a.state === 'open' ? -1 : 1) || a.id.localeCompare(b.id))
  return result.length ? result : undefined
}

function addHistory(target: { operationHistory?: OperationHistoryEntry[] } | undefined, event: OperationEvent) {
  if (!target) return
  target.operationHistory = [...(target.operationHistory ?? []), { id: uid('operation-state'), eventId: event.id, effectiveAt: event.effectiveAt, state: event.state }]
}

function remainsConnected(project: ActualRouteProject, lineId: string, stationId: string, selected: Set<string>, date: string) {
  return project.geometry.segments.some(segment => segment.lineId === lineId && !selected.has(segment.id) && (segment.fromStationId === stationId || segment.toStationId === stationId) && isSegmentOperationalAt(segment, date))
}

function previousDate(date: string) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10) }
function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }
