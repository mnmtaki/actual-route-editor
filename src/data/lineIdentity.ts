import type { ActualRouteProject, Line } from './model'
import { getLineParentIdAt } from './lineParentHistory'
import { getLineOwnColorAt } from './lineColorHistory'

export function getRootLineId(project: ActualRouteProject, lineOrId: string | Line, date?: string | null): string {
  const start = typeof lineOrId === 'string' ? lineOrId : lineOrId.id
  const byId = new Map(project.lines.map(line => [line.id, line]))
  const seen = new Set<string>()
  let current = start
  while (!seen.has(current)) {
    seen.add(current)
    const line = byId.get(current)
    const parentLineId = line ? getLineParentIdAt(line, date) : undefined
    if (!parentLineId || !byId.has(parentLineId)) return current
    current = parentLineId
  }
  return start
}

export function getRootLine(project: ActualRouteProject, lineOrId: string | Line, date?: string | null): Line | undefined {
  return project.lines.find(line => line.id === getRootLineId(project, lineOrId, date))
}

export function isBranchLine(line: Line, date?: string | null): boolean {
  return Boolean(getLineParentIdAt(line, date))
}

export function areLinesSameServiceFamily(project: ActualRouteProject, a: string | Line, b: string | Line, date?: string | null): boolean {
  return getRootLineId(project, a, date) === getRootLineId(project, b, date)
}

export function getEffectiveLineColor(project: ActualRouteProject, lineOrId: string | Line, date?: string | null): string {
  const byId = new Map(project.lines.map(line => [line.id, line]))
  const start = typeof lineOrId === 'string' ? byId.get(lineOrId) : lineOrId
  if (!start) return '#64748b'
  const seen = new Set<string>()
  let line = start
  while (!seen.has(line.id)) {
    const parentLineId = getLineParentIdAt(line, date)
    if (!parentLineId) break
    seen.add(line.id)
    const parent = byId.get(parentLineId)
    if (!parent) break
    line = parent
  }
  return getLineOwnColorAt(line, date)
}

export function lineWithEffectiveColor(project: ActualRouteProject, line: Line, date?: string | null): Line {
  const color = getEffectiveLineColor(project, line, date)
  return color === line.color ? line : { ...line, color }
}

export function getLineDisplayName(project: ActualRouteProject, lineOrId: string | Line): string {
  const line = typeof lineOrId === 'string' ? project.lines.find(item => item.id === lineOrId) : lineOrId
  if (!line) return ''
  const own = line.name.trim()
  if (own) return own
  return isBranchLine(line) ? '支线' : ''
}

export function collapseLinesByServiceFamily(project: ActualRouteProject, lines: Line[], date?: string | null): Line[] {
  const result: Line[] = []
  const indexByRoot = new Map<string, number>()
  for (const line of lines) {
    const rootId = getRootLineId(project, line, date)
    const existingIndex = indexByRoot.get(rootId)
    if (existingIndex === undefined) {
      indexByRoot.set(rootId, result.length)
      result.push(line)
      continue
    }
    const existing = result[existingIndex]
    if (isBranchLine(existing, date) && !isBranchLine(line, date)) result[existingIndex] = line
  }
  return result
}

export function collapseLineIdsByServiceFamily(project: ActualRouteProject, lineIds: string[], date?: string | null): string[] {
  return collapseLinesByServiceFamily(project, lineIds.map(id => project.lines.find(line => line.id === id)).filter((line): line is Line => Boolean(line)), date).map(line => line.id)
}

export function validateLineParentRelations(project: ActualRouteProject): string[] {
  const errors: string[] = []
  const byId = new Map(project.lines.map(line => [line.id, line]))
  for (const line of project.lines) {
    if (!line.parentLineId) continue
    if (line.parentLineId === line.id) errors.push('线路 ' + line.id + ' 不能将自己设为主线')
    else if (!byId.has(line.parentLineId)) errors.push('线路 ' + line.id + ' 引用了不存在的主线 ' + line.parentLineId)
  }
  for (const line of project.lines) {
    const seen = new Set<string>()
    let current: string | undefined = line.id
    while (current) {
      if (seen.has(current)) {
        errors.push('线路 ' + line.id + ' 的主线关系存在循环')
        break
      }
      seen.add(current)
      current = byId.get(current)?.parentLineId
    }
  }
  return [...new Set(errors)]
}