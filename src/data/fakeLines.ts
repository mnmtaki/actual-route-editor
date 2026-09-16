import type { ActualRouteProject, Line } from './model'
import { materializeAarcFakeLineService } from './aarcFakeLineService'

/** A fake line remains editable/renderable map artwork but is excluded from passenger/operating semantics. */
export function isFakeLine(line: Line | null | undefined): boolean {
  return Boolean(line?.isFake)
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
  return next
}

export function getOperatingLines(project: ActualRouteProject): Line[] {
  return project.lines.filter(line => !isFakeLine(line))
}

export function getOperatingLineCount(project: ActualRouteProject): number {
  return getOperatingLines(project).length
}
