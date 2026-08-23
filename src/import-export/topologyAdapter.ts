import type { ActualRouteProject, Line, Segment, Station, StationLineRelation } from '../data/model'
import { DEFAULT_SETTINGS } from '../data/model'

interface LegacyPoint { id: string | number; name?: string; pos?: [number, number]; sta?: number; isFake?: boolean }
interface LegacyLine { id: string | number; name?: string; color?: string; pts?: (string | number)[]; type?: number; isFake?: boolean }
interface LegacyTopology { lines?: LegacyLine[]; points?: LegacyPoint[]; pointLinks?: { pts?: (string | number)[] }[] }

export function importTopologyJson(text: string): ActualRouteProject {
  const source = JSON.parse(text) as LegacyTopology
  if (!Array.isArray(source.lines) || !Array.isArray(source.points)) throw new Error('未识别到 lines / points')
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const p = parent.get(id) ?? id
    if (p === id) return id
    const root = find(p); parent.set(id, root); return root
  }
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra) }
  source.points.forEach((point) => parent.set(String(point.id), String(point.id)))
  source.pointLinks?.forEach((link) => link.pts?.slice(1).forEach((id) => union(String(link.pts![0]), String(id))))

  const pointById = new Map(source.points.map((point) => [String(point.id), point]))
  const usableLines = source.lines.filter((line) => line.type !== 1 && !line.isFake && line.name?.trim() && Array.isArray(line.pts))
  const stationPointIds = new Set<string>()
  usableLines.forEach((line) => line.pts!.forEach((id) => {
    const point = pointById.get(String(id)); if (point?.sta === 1 && point.name?.trim() && !point.isFake) stationPointIds.add(String(id))
  }))
  const namedByRoot = new Map<string, LegacyPoint>()
  stationPointIds.forEach((id) => { const point = pointById.get(id)!; if (!namedByRoot.has(find(id))) namedByRoot.set(find(id), point) })

  const stationRoots: string[] = []
  usableLines.forEach((line) => line.pts!.forEach((id) => {
    const root = find(String(id)); if (namedByRoot.has(root) && !stationRoots.includes(root)) stationRoots.push(root)
  }))
  const stations: Station[] = stationRoots.map((root, index) => {
    const angle = (index / Math.max(1, stationRoots.length)) * Math.PI * 2
    const point = namedByRoot.get(root)!
    return { id: `station_${root}`, name: point.name!.trim(), x: 520 + Math.cos(angle) * 360, y: 390 + Math.sin(angle) * 280, labelOffsetX: 14, labelOffsetY: -14 }
  })
  const lines: Line[] = usableLines.map((line, lineOrder) => {
    const sequence = line.pts!.map((id) => find(String(id))).filter((root, index, all) => namedByRoot.has(root) && root !== all[index - 1]).map((root) => `station_${root}`)
    return { id: `line_${line.id}`, name: line.name!.trim(), color: line.color || '#444444', stationSequence: sequence, lineOrder, visible: true, locked: false }
  }).filter((line) => line.stationSequence.length > 1)
  const relations: StationLineRelation[] = []
  const segments: Segment[] = []
  lines.forEach((line) => {
    line.stationSequence.forEach((stationId) => relations.push({ id: `rel_${line.id}_${stationId}`, stationId, lineId: line.id }))
    line.stationSequence.slice(1).forEach((to, index) => segments.push({ id: `segment_${line.id}_${index}`, lineId: line.id, fromStationId: line.stationSequence[index], toStationId: to, mode: 'straight', waypoints: [] }))
  })
  return { version: 1, name: '导入的架空线网', stations, lines, stationLineRelations: relations, geometry: { segments }, background: null, timeline: { currentDate: '2026-01-01', startDate: '2000-01-01', endDate: '2026-01-01', playing: false }, settings: DEFAULT_SETTINGS }
}
