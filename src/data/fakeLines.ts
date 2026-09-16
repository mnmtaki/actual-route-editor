import type { ActualRouteProject, Line } from './model'

/** A fake line remains editable/renderable map artwork but is excluded from passenger/operating semantics. */
export function isFakeLine(line: Line | null | undefined): boolean {
  return Boolean(line?.isFake)
}

export function setLineFake(project: ActualRouteProject, lineId: string, fake: boolean): ActualRouteProject {
  const next = structuredClone(project)
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
