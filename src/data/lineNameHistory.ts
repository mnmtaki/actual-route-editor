import type { Line, LineNameHistoryEntry } from './model'

export type ResolvedLineName = Pick<LineNameHistoryEntry, 'name'>

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export function normalizeLineNameHistory(line: Pick<Line, 'id' | 'name' | 'nameHistory'>): LineNameHistoryEntry[] | undefined {
  if (!Array.isArray(line.nameHistory) || !line.nameHistory.length) return undefined
  const baseline = line.nameHistory
    .filter(entry => entry && entry.effectiveAt === null && typeof entry.id === 'string' && typeof entry.name === 'string')
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  const dated = line.nameHistory
    .filter(entry => entry && isDate(entry.effectiveAt) && typeof entry.id === 'string' && typeof entry.name === 'string')
    .sort((a, b) => entryDate(a).localeCompare(entryDate(b)) || a.id.localeCompare(b.id))
  const uniqueDates = dated.filter((entry, index) => index === 0 || dated[index - 1].effectiveAt !== entry.effectiveAt)
  const result: LineNameHistoryEntry[] = []
  if (baseline) result.push({ id: baseline.id, effectiveAt: null, name: baseline.name })
  else result.push({ id: `name-base-${line.id}`, effectiveAt: null, name: line.name })
  result.push(...uniqueDates.map(entry => ({ id: entry.id, effectiveAt: entry.effectiveAt, name: entry.name })))
  return result
}

function entryDate(entry: LineNameHistoryEntry) {
  return entry.effectiveAt ?? ''
}

export function getLineNameAt(line: Line, date?: string | null): ResolvedLineName {
  const history = normalizeLineNameHistory(line)
  if (!history || !date) return { name: line.name }
  let result: ResolvedLineName = { name: history[0].name }
  for (const entry of history) if (entry.effectiveAt && entry.effectiveAt <= date) result = { name: entry.name }
  return result
}

export function syncLineNameFromHistory(line: Line) {
  const history = normalizeLineNameHistory(line)
  if (!history) return
  line.nameHistory = history
  line.name = history.at(-1)!.name
}

export function updateLineNameHistoryEntry(line: Line, entry: LineNameHistoryEntry) {
  const history = normalizeLineNameHistory(line) ?? [{ id: `name-base-${line.id}`, effectiveAt: null, name: line.name }]
  if (entry.effectiveAt !== null && history.some(item => item.id !== entry.id && item.effectiveAt === entry.effectiveAt)) throw new Error('同一天只能有一次线路名称变更')
  const next = { ...entry, name: entry.name.trim() }
  if (!next.name) throw new Error('线路名称不能为空')
  const index = history.findIndex(item => item.id === entry.id)
  if (index >= 0) history[index] = next
  else history.push(next)
  line.nameHistory = history
  syncLineNameFromHistory(line)
}

export function removeLineNameHistoryEntry(line: Line, entryId: string) {
  const history = normalizeLineNameHistory(line)
  if (!history) return
  const target = history.find(entry => entry.id === entryId)
  if (!target || target.effectiveAt === null) return
  const next = history.filter(entry => entry.id !== entryId)
  if (next.length === 1 && next[0].effectiveAt === null) {
    line.name = next[0].name
    delete line.nameHistory
    return
  }
  line.nameHistory = next
  syncLineNameFromHistory(line)
}

export function setCurrentLineName(line: Line, name: string) {
  const history = normalizeLineNameHistory(line)
  if (!history) {
    line.name = name
    return
  }
  const latest = history.at(-1)!
  updateLineNameHistoryEntry(line, { ...latest, name })
}
