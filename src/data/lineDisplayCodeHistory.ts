import type { ActualRouteProject, Line, LineDisplayCodeHistoryEntry } from './model'

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export function resolveCurrentLineDisplayCode(line: Pick<Line, 'name' | 'displayCode' | 'number' | 'code' | 'shortName'>): string {
  const explicit = line.displayCode ?? line.number ?? line.code ?? line.shortName
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const match = /^\s*(\d{1,3})/.exec(line.name)
  return match?.[1] ?? line.name.trim().slice(0, 4)
}

export function normalizeLineDisplayCodeHistory(line: Pick<Line, 'id' | 'name' | 'displayCode' | 'number' | 'code' | 'shortName' | 'displayCodeHistory'>): LineDisplayCodeHistoryEntry[] | undefined {
  if (!Array.isArray(line.displayCodeHistory) || !line.displayCodeHistory.length) return undefined
  const baseline = line.displayCodeHistory
    .filter(entry => entry && entry.effectiveAt === null && typeof entry.id === 'string' && typeof entry.displayCode === 'string' && entry.displayCode.trim())
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  const dated = line.displayCodeHistory
    .filter(entry => entry && isDate(entry.effectiveAt) && typeof entry.id === 'string' && typeof entry.displayCode === 'string' && entry.displayCode.trim())
    .sort((a, b) => (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? '') || a.id.localeCompare(b.id))
  const uniqueDates = dated.filter((entry, index) => index === 0 || dated[index - 1].effectiveAt !== entry.effectiveAt)
  const result: LineDisplayCodeHistoryEntry[] = [{
    id: baseline?.id ?? `display-code-base-${line.id}`,
    effectiveAt: null,
    displayCode: baseline?.displayCode.trim() || resolveCurrentLineDisplayCode(line),
  }]
  result.push(...uniqueDates.map(entry => ({ id: entry.id, effectiveAt: entry.effectiveAt, displayCode: entry.displayCode.trim() })))
  return result
}

export function getLineDisplayCodeAt(line: Line, date?: string | null): string {
  const history = normalizeLineDisplayCodeHistory(line)
  if (!history || !date) return resolveCurrentLineDisplayCode(line)
  let displayCode = history[0].displayCode
  for (const entry of history) if (entry.effectiveAt && entry.effectiveAt <= date) displayCode = entry.displayCode
  return displayCode
}

export function syncLineDisplayCodeFromHistory(line: Line) {
  const history = normalizeLineDisplayCodeHistory(line)
  if (!history) return
  line.displayCodeHistory = history
  line.displayCode = history.at(-1)!.displayCode
}

export function updateLineDisplayCodeHistoryEntry(line: Line, entry: LineDisplayCodeHistoryEntry) {
  const displayCode = entry.displayCode.trim()
  if (!displayCode) throw new Error('线路代码不能为空')
  const history = normalizeLineDisplayCodeHistory(line) ?? [{
    id: `display-code-base-${line.id}`,
    effectiveAt: null,
    displayCode: resolveCurrentLineDisplayCode(line),
  }]
  if (entry.effectiveAt !== null && history.some(item => item.id !== entry.id && item.effectiveAt === entry.effectiveAt)) throw new Error('同一天只能有一次线路代码变更')
  const next: LineDisplayCodeHistoryEntry = { ...entry, displayCode }
  const index = history.findIndex(item => item.id === entry.id)
  if (index >= 0) history[index] = next
  else history.push(next)
  line.displayCodeHistory = history
  syncLineDisplayCodeFromHistory(line)
}

export function removeLineDisplayCodeHistoryEntry(line: Line, entryId: string) {
  const history = normalizeLineDisplayCodeHistory(line)
  if (!history) return
  const target = history.find(entry => entry.id === entryId)
  if (!target || target.effectiveAt === null) return
  const next = history.filter(entry => entry.id !== entryId)
  if (next.length === 1 && next[0].effectiveAt === null) {
    line.displayCode = next[0].displayCode
    delete line.displayCodeHistory
    return
  }
  line.displayCodeHistory = next
  syncLineDisplayCodeFromHistory(line)
}

export function setCurrentLineDisplayCode(line: Line, displayCode: string) {
  const next = displayCode.trim()
  if (!next) throw new Error('线路代码不能为空')
  const history = normalizeLineDisplayCodeHistory(line)
  if (!history) {
    line.displayCode = next
    return
  }
  updateLineDisplayCodeHistoryEntry(line, { ...history.at(-1)!, displayCode: next })
}

export function projectWithLineDisplayCodesAt(project: ActualRouteProject, date: string): ActualRouteProject {
  return {
    ...project,
    lines: project.lines.map(line => ({ ...line, displayCode: getLineDisplayCodeAt(line, date) })),
  }
}
