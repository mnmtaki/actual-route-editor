import type { Station, StationNameHistoryEntry } from './model'

export type ResolvedStationName = Pick<StationNameHistoryEntry, 'name' | 'nameS'>

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const cleanNameS = (value: unknown) => typeof value === 'string' && value.length ? value : undefined

export function normalizeStationNameHistory(station: Pick<Station, 'name' | 'nameS' | 'nameHistory'>): StationNameHistoryEntry[] | undefined {
  if (!Array.isArray(station.nameHistory) || !station.nameHistory.length) return undefined
  const baseline = station.nameHistory.filter(entry => entry && entry.effectiveAt === null && typeof entry.id === 'string' && typeof entry.name === 'string').sort((a, b) => a.id.localeCompare(b.id))[0]
  const dated = station.nameHistory.filter(entry => entry && isDate(entry.effectiveAt) && typeof entry.id === 'string' && typeof entry.name === 'string').sort((a, b) => a.effectiveAt!.localeCompare(b.effectiveAt!) || a.id.localeCompare(b.id))
  const uniqueDates = dated.filter((entry, index) => index === 0 || dated[index - 1].effectiveAt !== entry.effectiveAt)
  const result: StationNameHistoryEntry[] = []
  if (baseline) result.push({ id: baseline.id, effectiveAt: null, name: baseline.name, ...(cleanNameS(baseline.nameS) ? { nameS: cleanNameS(baseline.nameS) } : {}) })
  else result.push({ id: `name-base-${station.name || 'station'}`, effectiveAt: null, name: station.name, ...(cleanNameS(station.nameS) ? { nameS: cleanNameS(station.nameS) } : {}) })
  result.push(...uniqueDates.map(entry => ({ id: entry.id, effectiveAt: entry.effectiveAt, name: entry.name, ...(cleanNameS(entry.nameS) ? { nameS: cleanNameS(entry.nameS) } : {}) })))
  return result
}

export function getStationNameAt(station: Station, date?: string | null): ResolvedStationName {
  const history = normalizeStationNameHistory(station)
  if (!history || !date) return { name: station.name, ...(station.nameS ? { nameS: station.nameS } : {}) }
  let result: ResolvedStationName = { name: history[0].name, ...(history[0].nameS ? { nameS: history[0].nameS } : {}) }
  for (const entry of history) if (entry.effectiveAt && entry.effectiveAt <= date) result = { name: entry.name, ...(entry.nameS ? { nameS: entry.nameS } : {}) }
  return result
}

export function syncStationNameFromHistory(station: Station) {
  const history = normalizeStationNameHistory(station)
  if (!history) return
  station.nameHistory = history
  const current = history.at(-1)!
  station.name = current.name
  if (current.nameS) station.nameS = current.nameS
  else delete station.nameS
}

export function updateStationNameHistoryEntry(station: Station, entry: StationNameHistoryEntry) {
  const history = normalizeStationNameHistory(station) ?? [{ id: `name-base-${station.id}`, effectiveAt: null, name: station.name, ...(station.nameS ? { nameS: station.nameS } : {}) }]
  if (entry.effectiveAt !== null && history.some(item => item.id !== entry.id && item.effectiveAt === entry.effectiveAt)) throw new Error('同一天只能有一次站名变更')
  const index = history.findIndex(item => item.id === entry.id)
  const next = { ...entry, ...(cleanNameS(entry.nameS) ? { nameS: cleanNameS(entry.nameS) } : {}) }
  if (!next.name.trim()) throw new Error('中文站名不能为空')
  if (!next.nameS) delete next.nameS
  if (index >= 0) history[index] = next
  else history.push(next)
  station.nameHistory = history
  syncStationNameFromHistory(station)
}

export function removeStationNameHistoryEntry(station: Station, entryId: string) {
  const history = normalizeStationNameHistory(station)
  if (!history) return
  const target = history.find(entry => entry.id === entryId)
  if (!target || target.effectiveAt === null) return
  const next = history.filter(entry => entry.id !== entryId)
  if (next.length === 1 && next[0].effectiveAt === null) {
    station.name = next[0].name
    if (next[0].nameS) station.nameS = next[0].nameS
    else delete station.nameS
    delete station.nameHistory
    return
  }
  station.nameHistory = next
  syncStationNameFromHistory(station)
}

export function setCurrentStationName(station: Station, value: ResolvedStationName) {
  const history = normalizeStationNameHistory(station)
  if (!history) {
    station.name = value.name
    if (value.nameS) station.nameS = value.nameS
    else delete station.nameS
    return
  }
  const latest = history.at(-1)!
  updateStationNameHistoryEntry(station, { ...latest, name: value.name, ...(value.nameS ? { nameS: value.nameS } : {}) })
}
