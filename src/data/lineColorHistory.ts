import type { ActualRouteProject, Line, LineColorHistoryEntry } from './model'

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export function normalizeLineColorHistory(line: Pick<Line, 'id' | 'color' | 'colorHistory'>): LineColorHistoryEntry[] | undefined {
  if (!Array.isArray(line.colorHistory) || !line.colorHistory.length) return undefined
  const baseline = line.colorHistory
    .filter(entry => entry && entry.effectiveAt === null && typeof entry.id === 'string' && typeof entry.color === 'string' && entry.color.trim())
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  const dated = line.colorHistory
    .filter(entry => entry && isDate(entry.effectiveAt) && typeof entry.id === 'string' && typeof entry.color === 'string' && entry.color.trim())
    .sort((a, b) => (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? '') || a.id.localeCompare(b.id))
  const uniqueDates = dated.filter((entry, index) => index === 0 || dated[index - 1].effectiveAt !== entry.effectiveAt)
  const result: LineColorHistoryEntry[] = [{
    id: baseline?.id ?? `color-base-${line.id}`,
    effectiveAt: null,
    color: baseline?.color.trim() || line.color,
  }]
  result.push(...uniqueDates.map(entry => ({ id: entry.id, effectiveAt: entry.effectiveAt, color: entry.color.trim() })))
  return result
}

export function getLineOwnColorAt(line: Line, date?: string | null): string {
  const history = normalizeLineColorHistory(line)
  if (!history || !date) return line.color
  let color = history[0].color
  for (const entry of history) if (entry.effectiveAt && entry.effectiveAt <= date) color = entry.color
  return color
}

export function syncLineColorFromHistory(line: Line) {
  const history = normalizeLineColorHistory(line)
  if (!history) return
  line.colorHistory = history
  line.color = history.at(-1)!.color
}

export function updateLineColorHistoryEntry(line: Line, entry: LineColorHistoryEntry) {
  const color = entry.color.trim()
  if (!color) throw new Error('线路颜色不能为空')
  const history = normalizeLineColorHistory(line) ?? [{ id: `color-base-${line.id}`, effectiveAt: null, color: line.color }]
  if (entry.effectiveAt !== null && history.some(item => item.id !== entry.id && item.effectiveAt === entry.effectiveAt)) throw new Error('同一天只能有一次线路颜色变更')
  const next: LineColorHistoryEntry = { ...entry, color }
  const index = history.findIndex(item => item.id === entry.id)
  if (index >= 0) history[index] = next
  else history.push(next)
  line.colorHistory = history
  syncLineColorFromHistory(line)
}

export function removeLineColorHistoryEntry(line: Line, entryId: string) {
  const history = normalizeLineColorHistory(line)
  if (!history) return
  const target = history.find(entry => entry.id === entryId)
  if (!target || target.effectiveAt === null) return
  const next = history.filter(entry => entry.id !== entryId)
  if (next.length === 1 && next[0].effectiveAt === null) {
    line.color = next[0].color
    delete line.colorHistory
    return
  }
  line.colorHistory = next
  syncLineColorFromHistory(line)
}

export function setCurrentLineOwnColor(line: Line, color: string) {
  const history = normalizeLineColorHistory(line)
  if (!history) {
    line.color = color
    return
  }
  updateLineColorHistoryEntry(line, { ...history.at(-1)!, color })
}

export function projectWithLineColorsAt(project: ActualRouteProject, date: string): ActualRouteProject {
  return {
    ...project,
    lines: project.lines.map(line => ({ ...line, color: getLineOwnColorAt(line, date) })),
  }
}
