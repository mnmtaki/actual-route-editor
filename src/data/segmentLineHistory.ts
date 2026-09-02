import type { Segment, SegmentLineHistoryEntry } from './model'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidSegmentLineHistoryDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value)
}

export function sortSegmentLineHistory(entries: SegmentLineHistoryEntry[]): SegmentLineHistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.effectiveAt === null) return b.effectiveAt === null ? a.id.localeCompare(b.id) : -1
    if (b.effectiveAt === null) return 1
    return a.effectiveAt.localeCompare(b.effectiveAt) || a.id.localeCompare(b.id)
  })
}

export function normalizeSegmentLineHistory(value: unknown): SegmentLineHistoryEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: SegmentLineHistoryEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.lineId !== 'string' || !raw.lineId) continue
    const effectiveAt = raw.effectiveAt === null ? null : isValidSegmentLineHistoryDate(raw.effectiveAt) ? raw.effectiveAt : undefined
    if (effectiveAt === undefined) continue
    entries.push({ id: raw.id, effectiveAt, lineId: raw.lineId })
  }
  if (!entries.length) return undefined
  const ordered = sortSegmentLineHistory(entries)
  const seen = new Set<string>(), result: SegmentLineHistoryEntry[] = []
  for (const entry of ordered) {
    const key = entry.effectiveAt ?? '__baseline__'
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }
  return result.length ? result : undefined
}

export function validateSegmentLineHistory(segment: Pick<Segment, 'lineId' | 'lineHistory'>): string[] {
  const rawEntries = Array.isArray(segment.lineHistory) ? segment.lineHistory.filter(entry => entry && typeof entry.id === 'string' && typeof entry.lineId === 'string' && (entry.effectiveAt === null || isValidSegmentLineHistoryDate(entry.effectiveAt))) : []
  if (!rawEntries.length) return []
  const errors: string[] = []
  if (rawEntries.filter(entry => entry.effectiveAt === null).length > 1) errors.push('一个区间只能有一个历史基准线路')
  const dates = new Set<string>()
  for (const entry of rawEntries) {
    if (entry.effectiveAt !== null && dates.has(entry.effectiveAt)) errors.push(`区间线路归属在 ${entry.effectiveAt} 重复变更`)
    if (entry.effectiveAt !== null) dates.add(entry.effectiveAt)
  }
  if (!rawEntries.some(entry => entry.effectiveAt === null)) errors.push('线路归属历史必须包含基准线路')
  return errors
}
export function resolveSegmentLineAt(segment: Pick<Segment, 'lineId' | 'lineHistory'>, historyDate: string): string {
  const entries = normalizeSegmentLineHistory(segment.lineHistory)
  if (!entries) return segment.lineId
  let lineId = entries.find(entry => entry.effectiveAt === null)?.lineId ?? segment.lineId
  for (const entry of entries) {
    if (entry.effectiveAt !== null && entry.effectiveAt <= historyDate) lineId = entry.lineId
  }
  return lineId
}

export function appendSegmentLineHistory(segment: Segment, lineId: string, effectiveAt: string, id: string): void {
  const normalized = normalizeSegmentLineHistory(segment.lineHistory)
  const existing = normalized?.some(entry => entry.effectiveAt === null) ? normalized : [{ id: `${segment.id}-baseline`, effectiveAt: null, lineId: normalized?.[0]?.lineId ?? segment.lineId }, ...(normalized ?? [])]
  const withoutDate = existing.filter(entry => entry.effectiveAt !== effectiveAt)
  withoutDate.push({ id, effectiveAt, lineId })
  segment.lineHistory = sortSegmentLineHistory(withoutDate)
  segment.lineId = lineId
}