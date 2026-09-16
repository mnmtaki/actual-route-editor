import type { ActualRouteProject, Line } from './model'
import { materializeAarcFakeLineService } from './aarcFakeLineService'

/** A fake line remains editable/renderable map artwork but is excluded from passenger/operating semantics. */
export function isFakeLine(line: Line | null | undefined): boolean {
  return Boolean(line?.isFake)
}

function finite(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function syncAarcSourceFakeState(project: ActualRouteProject, line: Line, fake: boolean) {
  if (line.source?.format !== 'aarc') return
  const sourceId = finite(line.source.sourceLineId ?? line.source.lineId)
  if (sourceId === undefined) return
  const rawLines = project.aarc?.raw?.lines
  if (Array.isArray(rawLines)) {
    const raw = rawLines.find(item => item && typeof item === 'object' && finite((item as Record<string, unknown>).id) === sourceId) as Record<string, unknown> | undefined
    if (raw) raw.isFake = fake
  }
  for (const raw of project.aarc?.fakeLines ?? []) if (finite(raw.id) === sourceId) raw.isFake = fake
}

export function setLineFake(project: ActualRouteProject, lineId: string, fake: boolean): ActualRouteProject {
  const current = project.lines.find(item => item.id === lineId)
  if (!current || Boolean(current.isFake) === fake) return project

  // Imported AARC fake lines initially keep only their source-faithful visual
  // geometry. On the first promotion to a normal line, materialize that source
  // chain into native stations, relations and segments. Those objects are kept
  // when toggling back to fake so the operation is reversible and non-destructive.
  const base = fake ? project : materializeAarcFakeLineService(project, lineId)
  const next = structuredClone(base)
  const line = next.lines.find(item => item.id === lineId)
  if (!line) return project
  if (fake) line.isFake = true
  else delete line.isFake
  syncAarcSourceFakeState(next, line, fake)
  return next
}

export function getOperatingLines(project: ActualRouteProject): Line[] {
  return project.lines.filter(line => !isFakeLine(line))
}

export function getOperatingLineCount(project: ActualRouteProject): number {
  return getOperatingLines(project).length
}
