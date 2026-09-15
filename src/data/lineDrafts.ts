import type { ActualRouteProject, LineDraft, LineDraftPoint } from './model'
import { uid } from './model'

export function normalizeLineDrafts(value: unknown): LineDraft[] | undefined {
  if (!Array.isArray(value)) return undefined
  const drafts = value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || typeof item.lineId !== 'string' || !item.lineId) return []
    const anchorStationId = item.anchorStationId === null ? null : typeof item.anchorStationId === 'string' ? item.anchorStationId : null
    const points = Array.isArray(item.points) ? item.points.flatMap(point => normalizePoint(point)) : []
    return [{
      id: item.id,
      lineId: item.lineId,
      anchorStationId,
      ...(typeof item.phaseId === 'string' && item.phaseId ? { phaseId: item.phaseId } : {}),
      points,
      ...(typeof item.lastCreatedStationId === 'string' && item.lastCreatedStationId ? { lastCreatedStationId: item.lastCreatedStationId } : {}),
    } satisfies LineDraft]
  })
  return drafts.length ? drafts : undefined
}

export function createLineDraft(project: ActualRouteProject, lineId: string, anchorStationId: string | null, phaseId?: string): { project: ActualRouteProject; draftId: string } {
  const next = structuredClone(project), draftId = uid('line-draft')
  next.lineDrafts ??= []
  next.lineDrafts.push({ id: draftId, lineId, anchorStationId, ...(phaseId ? { phaseId } : {}), points: [] })
  return { project: next, draftId }
}

export function replaceLineDraft(project: ActualRouteProject, draft: LineDraft): ActualRouteProject {
  const next = structuredClone(project)
  next.lineDrafts ??= []
  const index = next.lineDrafts.findIndex(item => item.id === draft.id)
  if (index >= 0) next.lineDrafts[index] = structuredClone(draft)
  else next.lineDrafts.push(structuredClone(draft))
  return next
}

export function deleteLineDraft(project: ActualRouteProject, draftId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.lineDrafts = (next.lineDrafts ?? []).filter(item => item.id !== draftId)
  if (!next.lineDrafts.length) delete next.lineDrafts
  return next
}

export function cleanLineDraftReferences(project: ActualRouteProject): ActualRouteProject {
  if (!project.lineDrafts?.length) return project
  const next = structuredClone(project), lineIds = new Set(next.lines.map(line => line.id)), stationIds = new Set(next.stations.map(station => station.id)), phaseIds = new Set(next.openingPhases.map(phase => phase.id))
  next.lineDrafts = (next.lineDrafts ?? []).filter(draft => lineIds.has(draft.lineId) && draft.points.length > 0 && Boolean(draft.anchorStationId && stationIds.has(draft.anchorStationId))).map(draft => ({ ...draft, ...(draft.phaseId && phaseIds.has(draft.phaseId) ? { phaseId: draft.phaseId } : { phaseId: undefined }), ...(draft.lastCreatedStationId && stationIds.has(draft.lastCreatedStationId) ? { lastCreatedStationId: draft.lastCreatedStationId } : { lastCreatedStationId: undefined }) }))
  if (!next.lineDrafts.length) delete next.lineDrafts
  return next
}

function normalizePoint(value: unknown): LineDraftPoint[] {
  if (!value || typeof value !== 'object') return []
  const item = value as Record<string, unknown>, x = Number(item.x), y = Number(item.y)
  return typeof item.id === 'string' && item.id && Number.isFinite(x) && Number.isFinite(y) ? [{ id: item.id, x, y }] : []
}
