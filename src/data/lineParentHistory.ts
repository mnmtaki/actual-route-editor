import type { ActualRouteProject, Line, LineParentHistoryEntry } from './model'

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export function normalizeLineParentHistory(line: Pick<Line, 'id' | 'parentLineId' | 'parentHistory'>): LineParentHistoryEntry[] | undefined {
  if (!Array.isArray(line.parentHistory) || !line.parentHistory.length) return undefined
  const baseline = line.parentHistory
    .filter(entry => entry && entry.effectiveAt === null && typeof entry.id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  const dated = line.parentHistory
    .filter(entry => entry && isDate(entry.effectiveAt) && typeof entry.id === 'string')
    .sort((a, b) => (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? '') || a.id.localeCompare(b.id))
  const uniqueDates = dated.filter((entry, index) => index === 0 || dated[index - 1].effectiveAt !== entry.effectiveAt)
  const result: LineParentHistoryEntry[] = [{
    id: baseline?.id ?? `parent-base-${line.id}`,
    effectiveAt: null,
    parentLineId: typeof baseline?.parentLineId === 'string' && baseline.parentLineId ? baseline.parentLineId : baseline ? null : (line.parentLineId ?? null),
  }]
  result.push(...uniqueDates.map(entry => ({
    id: entry.id,
    effectiveAt: entry.effectiveAt,
    parentLineId: typeof entry.parentLineId === 'string' && entry.parentLineId ? entry.parentLineId : null,
  })))
  return result
}

export function getLineParentIdAt(line: Line, date?: string | null): string | undefined {
  const history = normalizeLineParentHistory(line)
  if (!history || !date) return line.parentLineId || undefined
  let parentLineId = history[0].parentLineId
  for (const entry of history) if (entry.effectiveAt && entry.effectiveAt <= date) parentLineId = entry.parentLineId
  return parentLineId || undefined
}

export function syncLineParentFromHistory(line: Line) {
  const history = normalizeLineParentHistory(line)
  if (!history) return
  line.parentHistory = history
  const current = history.at(-1)?.parentLineId
  if (current) line.parentLineId = current
  else delete line.parentLineId
}

function validateParentSnapshot(project: ActualRouteProject, date: string | null): string[] {
  const errors: string[] = []
  const byId = new Map(project.lines.map(line => [line.id, line]))
  const parentAt = (line: Line) => date ? getLineParentIdAt(line, date) : line.parentLineId
  for (const line of project.lines) {
    const parentLineId = parentAt(line)
    if (!parentLineId) continue
    if (parentLineId === line.id) errors.push(`线路 ${line.id} 不能将自己设为主线`)
    else if (!byId.has(parentLineId)) errors.push(`线路 ${line.id} 引用了不存在的主线 ${parentLineId}`)
  }
  for (const line of project.lines) {
    const seen = new Set<string>()
    let current: string | undefined = line.id
    while (current) {
      if (seen.has(current)) {
        errors.push(`线路 ${line.id} 的主线关系存在循环`)
        break
      }
      seen.add(current)
      const currentLine = byId.get(current)
      current = currentLine ? parentAt(currentLine) : undefined
    }
  }
  return [...new Set(errors)]
}

export function validateLineParentHistory(project: ActualRouteProject): string[] {
  const dates = new Set<string>()
  for (const line of project.lines) for (const entry of normalizeLineParentHistory(line) ?? []) if (entry.effectiveAt) dates.add(entry.effectiveAt)
  return [...new Set([
    ...validateParentSnapshot(project, null),
    ...[...dates].sort().flatMap(date => validateParentSnapshot(project, date)),
  ])]
}

export function updateLineParentHistoryEntry(project: ActualRouteProject, lineId: string, entry: LineParentHistoryEntry) {
  const original = project.lines.find(item => item.id === lineId)
  if (!original) throw new Error('未找到线路')
  const parentLineId = typeof entry.parentLineId === 'string' && entry.parentLineId ? entry.parentLineId : null
  if (parentLineId === lineId) throw new Error('线路不能将自己设为主线')
  if (parentLineId && !project.lines.some(item => item.id === parentLineId)) throw new Error('选择的主线不存在')

  const candidate = structuredClone(project)
  const line = candidate.lines.find(item => item.id === lineId)!
  const history = normalizeLineParentHistory(line) ?? [{ id: `parent-base-${line.id}`, effectiveAt: null, parentLineId: line.parentLineId ?? null }]
  if (entry.effectiveAt !== null && history.some(item => item.id !== entry.id && item.effectiveAt === entry.effectiveAt)) throw new Error('同一天只能有一次主支关系变更')
  const next: LineParentHistoryEntry = { ...entry, parentLineId }
  const index = history.findIndex(item => item.id === entry.id)
  if (index >= 0) history[index] = next
  else history.push(next)
  line.parentHistory = history
  syncLineParentFromHistory(line)
  const errors = validateLineParentHistory(candidate)
  if (errors.length) throw new Error(errors[0])

  original.parentHistory = structuredClone(line.parentHistory)
  if (line.parentLineId) original.parentLineId = line.parentLineId
  else delete original.parentLineId
}

export function removeLineParentHistoryEntry(project: ActualRouteProject, lineId: string, entryId: string) {
  const original = project.lines.find(item => item.id === lineId)
  if (!original) return
  const currentHistory = normalizeLineParentHistory(original)
  if (!currentHistory) return
  const target = currentHistory.find(entry => entry.id === entryId)
  if (!target || target.effectiveAt === null) return

  const candidate = structuredClone(project)
  const line = candidate.lines.find(item => item.id === lineId)!
  const history = normalizeLineParentHistory(line)!
  const next = history.filter(entry => entry.id !== entryId)
  if (next.length === 1 && next[0].effectiveAt === null) {
    const parent = next[0].parentLineId
    if (parent) line.parentLineId = parent
    else delete line.parentLineId
    delete line.parentHistory
  } else {
    line.parentHistory = next
    syncLineParentFromHistory(line)
  }
  const errors = validateLineParentHistory(candidate)
  if (errors.length) throw new Error(errors[0])

  if (line.parentHistory) original.parentHistory = structuredClone(line.parentHistory)
  else delete original.parentHistory
  if (line.parentLineId) original.parentLineId = line.parentLineId
  else delete original.parentLineId
}

export function clearDeletedLineParentReferences(project: ActualRouteProject, deletedIds: Set<string>) {
  for (const line of project.lines) {
    const history = normalizeLineParentHistory(line)
    if (!history) continue
    const next = history.map(entry => deletedIds.has(entry.parentLineId ?? '') ? { ...entry, parentLineId: null } : entry)
    line.parentHistory = next
    syncLineParentFromHistory(line)
  }
}

export function projectWithLineParentsAt(project: ActualRouteProject, date: string): ActualRouteProject {
  return {
    ...project,
    lines: project.lines.map(line => {
      const parentLineId = getLineParentIdAt(line, date)
      const next = { ...line }
      if (parentLineId) next.parentLineId = parentLineId
      else delete next.parentLineId
      return next
    }),
  }
}
