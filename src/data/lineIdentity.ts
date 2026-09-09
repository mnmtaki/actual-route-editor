import type { ActualRouteProject, Line } from './model'

export function getRootLineId(project: ActualRouteProject, lineOrId: string | Line): string {
  const start = typeof lineOrId === 'string' ? lineOrId : lineOrId.id
  const byId = new Map(project.lines.map(line => [line.id, line]))
  const seen = new Set<string>()
  let current = start
  while (!seen.has(current)) {
    seen.add(current)
    const line = byId.get(current)
    if (!line?.parentLineId || !byId.has(line.parentLineId)) return current
    current = line.parentLineId
  }
  return start
}

export function getRootLine(project: ActualRouteProject, lineOrId: string | Line): Line | undefined {
  return project.lines.find(line => line.id === getRootLineId(project, lineOrId))
}

export function isBranchLine(line: Line): boolean {
  return typeof line.parentLineId === 'string' && line.parentLineId.length > 0
}

export function areLinesSameServiceFamily(project: ActualRouteProject, a: string | Line, b: string | Line): boolean {
  return getRootLineId(project, a) === getRootLineId(project, b)
}

export function getEffectiveLineColor(project: ActualRouteProject, lineOrId: string | Line): string {
  const byId = new Map(project.lines.map(line => [line.id, line]))
  const start = typeof lineOrId === 'string' ? byId.get(lineOrId) : lineOrId
  if (!start) return '#64748b'
  const seen = new Set<string>()
  let line = start
  while (line.parentLineId && !seen.has(line.id)) {
    seen.add(line.id)
    const parent = byId.get(line.parentLineId)
    if (!parent) break
    line = parent
  }
  return line.color
}

export function lineWithEffectiveColor(project: ActualRouteProject, line: Line): Line {
  const color = getEffectiveLineColor(project, line)
  return color === line.color ? line : { ...line, color }
}

export function getLineDisplayName(project: ActualRouteProject, lineOrId: string | Line): string {
  const line = typeof lineOrId === 'string' ? project.lines.find(item => item.id === lineOrId) : lineOrId
  if (!line) return ''
  const own = line.name.trim()
  if (own) return own
  return isBranchLine(line) ? '支线' : ''
}

export function collapseLinesByServiceFamily(project: ActualRouteProject, lines: Line[]): Line[] {
  const result: Line[] = []
  const indexByRoot = new Map<string, number>()
  for (const line of lines) {
    const rootId = getRootLineId(project, line)
    const existingIndex = indexByRoot.get(rootId)
    if (existingIndex === undefined) {
      indexByRoot.set(rootId, result.length)
      result.push(line)
      continue
    }
    const existing = result[existingIndex]
    if (isBranchLine(existing) && !isBranchLine(line)) result[existingIndex] = line
  }
  return result
}

export function collapseLineIdsByServiceFamily(project: ActualRouteProject, lineIds: string[]): string[] {
  return collapseLinesByServiceFamily(project, lineIds.map(id => project.lines.find(line => line.id === id)).filter((line): line is Line => Boolean(line))).map(line => line.id)
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