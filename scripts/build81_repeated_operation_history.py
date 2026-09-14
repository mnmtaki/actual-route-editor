from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected 1 match, got {count}: {old[:80]!r}')
    write(path, text.replace(old, new, 1))

def regex_once(path, pattern, replacement):
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected 1 regex match, got {count}: {pattern[:80]!r}')
    write(path, next_text)

# ---- model -----------------------------------------------------------------
replace_once(
    'src/data/model.ts',
    "export interface LineBadge { id: string; x: number; y: number; size: number; rotation: number; visible: boolean }\nexport interface Line { id: string; name: string; nameSub?: string; number?: string; code?: string; shortName?: string; displayCode?: string; color: string; parentLineId?: string; lineWidth?: number; styleOverrides?: LineStyleOverrides; lineStyleId?: string; stationSequence: string[]; lineBadges?: LineBadge[]; lineOrder: number; openedAt?: ISODate; closedAt?: ISODate; visible: boolean; locked: boolean; source?: SourceMetadata }\nexport interface StationLineRelation { id: string; stationId: string; lineId: string; stationCode?: string; openedAt?: ISODate; closedAt?: ISODate; anchor?: { x: number; y: number } }\nexport interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }",
    "export type OperationState = 'open' | 'closed'\nexport interface OperationHistoryEntry { id: string; effectiveAt: string; state: OperationState; eventId?: string }\nexport interface OperationEvent { id: string; lineId: string; name?: string; effectiveAt: string; state: OperationState; segmentIds: string[]; stationRelationIds: string[]; affectsLine?: boolean }\nexport interface LineBadge { id: string; x: number; y: number; size: number; rotation: number; visible: boolean }\nexport interface Line { id: string; name: string; nameSub?: string; number?: string; code?: string; shortName?: string; displayCode?: string; color: string; parentLineId?: string; lineWidth?: number; styleOverrides?: LineStyleOverrides; lineStyleId?: string; stationSequence: string[]; lineBadges?: LineBadge[]; lineOrder: number; openedAt?: ISODate; closedAt?: ISODate; operationHistory?: OperationHistoryEntry[]; visible: boolean; locked: boolean; source?: SourceMetadata }\nexport interface StationLineRelation { id: string; stationId: string; lineId: string; stationCode?: string; openedAt?: ISODate; closedAt?: ISODate; operationHistory?: OperationHistoryEntry[]; anchor?: { x: number; y: number } }\nexport interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }",
)
replace_once(
    'src/data/model.ts',
    "export interface Segment { id: string; lineId: string; /** Undefined inherits Line.lineStyleId; null is an explicit AARC style=0 (base line only). */ lineStyleId?: string | null; lineHistory?: SegmentLineHistoryEntry[]; fromStationId: string; toStationId: string; mode: SegmentMode; cornerRadius?: number; structureType: StructureType; structureNodes?: StructureNode[]; waypoints: Waypoint[]; openedAt?: ISODate; closedAt?: ISODate; source?: SourceMetadata }",
    "export interface Segment { id: string; lineId: string; /** Undefined inherits Line.lineStyleId; null is an explicit AARC style=0 (base line only). */ lineStyleId?: string | null; lineHistory?: SegmentLineHistoryEntry[]; fromStationId: string; toStationId: string; mode: SegmentMode; cornerRadius?: number; structureType: StructureType; structureNodes?: StructureNode[]; waypoints: Waypoint[]; openedAt?: ISODate; closedAt?: ISODate; operationHistory?: OperationHistoryEntry[]; source?: SourceMetadata }",
)
replace_once(
    'src/data/model.ts',
    "export interface ActualRouteProject { version: 1; name: string; projectName?: string; distanceScale?: DistanceScale; stations: Station[]; lines: Line[]; stationLineRelations: StationLineRelation[]; openingPhases: OpeningPhase[]; geometry: { segments: Segment[] };",
    "export interface ActualRouteProject { version: 1; name: string; projectName?: string; distanceScale?: DistanceScale; stations: Station[]; lines: Line[]; stationLineRelations: StationLineRelation[]; openingPhases: OpeningPhase[]; operationEvents?: OperationEvent[]; geometry: { segments: Segment[] };",
)

# ---- generic operation event / lifecycle resolver ---------------------------
write('src/data/operationEvents.ts', r'''import type { ActualRouteProject, Line, OperationEvent, OperationHistoryEntry, OperationState, Segment, StationLineRelation } from './model'
import { uid } from './model'
import type { OpeningPhasePath } from './openingPhases'

export interface CreateOperationEventInput {
  lineId: string
  name?: string
  effectiveAt: string
  state: OperationState
  path: OpeningPhasePath
}

export function resolveOperationState(openedAt: string | null | undefined, closedAt: string | null | undefined, history: OperationHistoryEntry[] | undefined, time: string) {
  const entries: Array<{ effectiveAt: string; state: OperationState; order: number }> = []
  if (openedAt) entries.push({ effectiveAt: openedAt, state: 'open', order: 0 })
  if (closedAt) entries.push({ effectiveAt: closedAt, state: 'closed', order: 1 })
  for (const entry of history ?? []) if (validDate(entry.effectiveAt)) entries.push({ effectiveAt: entry.effectiveAt, state: entry.state, order: entry.state === 'closed' ? 1 : 0 })
  if (!entries.length) return true
  entries.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.order - b.order)
  let active = openedAt ? false : entries[0].state === 'closed'
  for (const entry of entries) {
    if (entry.effectiveAt > time) break
    active = entry.state === 'open'
  }
  return active
}

export function isLineOperationalAt(line: Line | undefined, time: string) { return Boolean(line && resolveOperationState(line.openedAt, line.closedAt, line.operationHistory, time)) }
export function isRelationOperationalAt(relation: StationLineRelation | undefined, time: string) { return Boolean(relation && resolveOperationState(relation.openedAt, relation.closedAt, relation.operationHistory, time)) }
export function isSegmentOperationalAt(segment: Segment | undefined, time: string) { return Boolean(segment && resolveOperationState(segment.openedAt, segment.closedAt, segment.operationHistory, time)) }

export function createOperationEvent(project: ActualRouteProject, input: CreateOperationEventInput): { project: ActualRouteProject; eventId: string } {
  const next = structuredClone(project)
  const eventId = uid('operation-event')
  const segmentIds = [...new Set(input.path.segmentIds)]
  const selected = new Set(segmentIds)
  const beforeDate = previousDate(input.effectiveAt)
  const stationRelationIds = [...new Set(input.path.stationIds.flatMap(stationId => {
    const relation = next.stationLineRelations.find(item => item.stationId === stationId && item.lineId === input.lineId)
    if (!relation) return []
    if (input.state === 'open') return isRelationOperationalAt(relation, beforeDate) ? [] : [relation.id]
    return remainsConnected(next, input.lineId, stationId, selected, input.effectiveAt) ? [] : [relation.id]
  }))]
  const allLineSegmentIds = next.geometry.segments.filter(segment => segment.lineId === input.lineId).map(segment => segment.id)
  const affectsLine = input.state === 'open' || (allLineSegmentIds.length > 0 && allLineSegmentIds.every(id => selected.has(id)))
  const event: OperationEvent = { id: eventId, lineId: input.lineId, name: input.name?.trim() || undefined, effectiveAt: input.effectiveAt, state: input.state, segmentIds, stationRelationIds, ...(affectsLine ? { affectsLine: true } : {}) }
  next.operationEvents = [...(next.operationEvents ?? []), event]
  for (const segmentId of segmentIds) addHistory(next.geometry.segments.find(item => item.id === segmentId), event)
  for (const relationId of stationRelationIds) addHistory(next.stationLineRelations.find(item => item.id === relationId), event)
  if (affectsLine) addHistory(next.lines.find(item => item.id === input.lineId), event)
  return { project: next, eventId }
}

export function updateOperationEvent(project: ActualRouteProject, eventId: string, patch: { name?: string; effectiveAt?: string }): ActualRouteProject {
  const next = structuredClone(project)
  const event = next.operationEvents?.find(item => item.id === eventId)
  if (!event) return project
  if (patch.name !== undefined) event.name = patch.name.trim() || undefined
  if (patch.effectiveAt && validDate(patch.effectiveAt)) {
    event.effectiveAt = patch.effectiveAt
    for (const target of [...next.lines, ...next.stationLineRelations, ...next.geometry.segments]) for (const entry of target.operationHistory ?? []) if (entry.eventId === eventId) entry.effectiveAt = patch.effectiveAt
  }
  return next
}

export function deleteOperationEvent(project: ActualRouteProject, eventId: string): ActualRouteProject {
  const next = structuredClone(project)
  next.operationEvents = (next.operationEvents ?? []).filter(item => item.id !== eventId)
  for (const target of [...next.lines, ...next.stationLineRelations, ...next.geometry.segments]) if (target.operationHistory) {
    target.operationHistory = target.operationHistory.filter(entry => entry.eventId !== eventId)
    if (!target.operationHistory.length) delete target.operationHistory
  }
  if (!next.operationEvents.length) delete next.operationEvents
  return next
}

export function normalizeOperationEvents(raw: unknown): OperationEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result = raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<OperationEvent>
    if (typeof item.id !== 'string' || typeof item.lineId !== 'string' || !validDate(item.effectiveAt) || (item.state !== 'open' && item.state !== 'closed')) return []
    return [{ id: item.id, lineId: item.lineId, ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.trim() } : {}), effectiveAt: item.effectiveAt!, state: item.state, segmentIds: Array.isArray(item.segmentIds) ? item.segmentIds.map(String) : [], stationRelationIds: Array.isArray(item.stationRelationIds) ? item.stationRelationIds.map(String) : [], ...(item.affectsLine === true ? { affectsLine: true } : {}) }]
  })
  return result.length ? result : undefined
}

export function normalizeOperationHistory(raw: unknown): OperationHistoryEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result = raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<OperationHistoryEntry>
    if (typeof item.id !== 'string' || !validDate(item.effectiveAt) || (item.state !== 'open' && item.state !== 'closed')) return []
    return [{ id: item.id, effectiveAt: item.effectiveAt!, state: item.state, ...(typeof item.eventId === 'string' && item.eventId ? { eventId: item.eventId } : {}) }]
  }).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || (a.state === 'open' ? -1 : 1) || a.id.localeCompare(b.id))
  return result.length ? result : undefined
}

function addHistory(target: { operationHistory?: OperationHistoryEntry[] } | undefined, event: OperationEvent) {
  if (!target) return
  target.operationHistory = [...(target.operationHistory ?? []), { id: uid('operation-state'), eventId: event.id, effectiveAt: event.effectiveAt, state: event.state }]
}

function remainsConnected(project: ActualRouteProject, lineId: string, stationId: string, selected: Set<string>, date: string) {
  return project.geometry.segments.some(segment => segment.lineId === lineId && !selected.has(segment.id) && (segment.fromStationId === stationId || segment.toStationId === stationId) && isSegmentOperationalAt(segment, date))
}

function previousDate(date: string) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10) }
function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }
''')

# ---- operation history editor ----------------------------------------------
write('src/components/OpeningPhaseEditor.tsx', r'''import { useEffect, useMemo, useState } from 'react'
import type { ActualRouteProject, Line, OpeningPhase, OperationEvent, OperationState } from '../data/model'
import { createOpeningPhase, deleteOpeningPhase, getOpeningPhasePathCandidates, updateOpeningPhase, type OpeningPhasePath } from '../data/openingPhases'
import { createOperationEvent, deleteOperationEvent, updateOperationEvent } from '../data/operationEvents'

type HistoryRow = { kind: 'phase'; phase: OpeningPhase } | { kind: 'event'; event: OperationEvent }

export function OpeningPhaseEditor({ project, line, onChange, onPreview, onStartDrawing }: {
  project: ActualRouteProject
  line: Line
  onChange: (next: ActualRouteProject) => void
  onPreview: (path: OpeningPhasePath | null) => void
  onStartDrawing: (phaseId: string, lineId: string, stationId: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [eventState, setEventState] = useState<OperationState>('open')
  const [eventDate, setEventDate] = useState(project.timeline.currentDate)
  const [startId, setStartId] = useState(line.stationSequence[0] ?? '')
  const [endId, setEndId] = useState(line.stationSequence.at(-1) ?? '')
  const [candidateIndex, setCandidateIndex] = useState(0)
  const rows: HistoryRow[] = [
    ...project.openingPhases.filter(phase => phase.lineId === line.id).map(phase => ({ kind: 'phase' as const, phase })),
    ...(project.operationEvents ?? []).filter(event => event.lineId === line.id).map(event => ({ kind: 'event' as const, event })),
  ].sort((a, b) => rowDate(a).localeCompare(rowDate(b)) || rowStateOrder(a) - rowStateOrder(b) || rowId(a).localeCompare(rowId(b)))
  const candidates = useMemo(() => getOpeningPhasePathCandidates(project, line.id, startId, endId), [project, line.id, startId, endId])
  const candidate = candidates[candidateIndex] ?? candidates[0] ?? null
  useEffect(() => { onPreview(adding ? candidate : null); return () => onPreview(null) }, [adding, candidate, onPreview])
  useEffect(() => { if (candidateIndex >= candidates.length) setCandidateIndex(0) }, [candidateIndex, candidates.length])

  const confirmExisting = () => {
    if (!eventDate || !candidate) return
    const result = createOperationEvent(project, { lineId: line.id, name, effectiveAt: eventDate, state: eventState, path: candidate })
    onChange(result.project); reset()
  }
  const startNewConstruction = () => {
    if (!eventDate || eventState !== 'open') return
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt: eventDate, revealStartStationId: startId || undefined })
    onChange(result.project); onStartDrawing(result.phaseId, line.id, startId || null); reset()
  }
  const reset = () => { setAdding(false); setName(''); setEventState('open'); setCandidateIndex(0); onPreview(null) }

  return <section className="opening-phases">
    <div className="opening-phases-title"><strong>运营历史</strong></div>
    {rows.length === 0 && <p className="meta-note">尚未建立运营事件；旧工程中的开通 / 停运日期仍会正常生效。</p>}
    {rows.map(row => <HistoryEventRow key={rowId(row)} row={row} project={project} onChange={onChange} onStartDrawing={onStartDrawing} />)}
    {!adding ? <button onClick={() => setAdding(true)}>＋ 添加运营事件</button> : <div className="opening-phase-form">
      <label className="field"><span>事件类型</span><select value={eventState} onChange={event => setEventState(event.target.value as OperationState)}><option value="open">开通</option><option value="closed">停运</option></select></label>
      <label className="field"><span>事件名称（可选）</span><input value={name} onChange={event => setName(event.target.value)} placeholder={eventState === 'open' ? '复开 / 东延 / 一期' : '区间停运 / 老线停运'} /></label>
      <label className="field"><span>{eventState === 'open' ? '开通日期' : '停运日期'}</span><input type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /></label>
      <div className="field-grid"><label className="field"><span>起点</span><select value={startId} onChange={event => { setStartId(event.target.value); setCandidateIndex(0) }}><StationOptions project={project} line={line} /></select></label><label className="field"><span>终点</span><select value={endId} onChange={event => { setEndId(event.target.value); setCandidateIndex(0) }}><StationOptions project={project} line={line} /></select></label></div>
      {candidates.length > 1 && <label className="field phase-warning"><span>存在 {candidates.length} 条候选路径，请选择</span><select value={candidateIndex} onChange={event => setCandidateIndex(Number(event.target.value))}>{candidates.map((path, index) => <option key={path.segmentIds.join('|')} value={index}>候选 {index + 1}：{path.stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' → ')}</option>)}</select></label>}
      {startId && endId && startId !== endId && candidates.length === 0 && <p className="phase-error">当前线路拓扑中找不到连续路径。</p>}
      {candidate && <p className="phase-preview-copy">作用于 {candidate.segmentIds.length} 个完整站间区间；同一天同时存在开通和停运时，停运优先。之后的新事件仍可重新开通。</p>}
      <button className="primary" disabled={!candidate || !eventDate} onClick={confirmExisting}>确认{eventState === 'open' ? '开通' : '停运'}事件</button>
      {eventState === 'open' && <button disabled={!startId || !eventDate} onClick={startNewConstruction}>从起点开始绘制新的开通阶段</button>}
      <button onClick={reset}>取消</button>
    </div>}
  </section>
}

function HistoryEventRow({ row, project, onChange, onStartDrawing }: { row: HistoryRow; project: ActualRouteProject; onChange: (next: ActualRouteProject) => void; onStartDrawing: (phaseId: string, lineId: string, stationId: string | null) => void }) {
  const legacy = row.kind === 'phase'
  const state: OperationState = legacy ? 'open' : row.event.state
  const date = legacy ? row.phase.openedAt : row.event.effectiveAt
  const segmentIds = legacy ? row.phase.segmentIds : row.event.segmentIds
  const stationIds = phaseStations(project, segmentIds)
  const label = stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' — ') || '等待绘制成员'
  const name = legacy ? row.phase.name : row.event.name
  const endpoint = stationIds.at(-1) ?? null
  const overrideCount = legacy ? (row.phase.overriddenSegmentIds?.length ?? 0) + (row.phase.overriddenStationRelationIds?.length ?? 0) : 0
  return <div className="opening-phase-row">
    <div><strong>{state === 'open' ? '开通' : '停运'} · {name || '未命名事件'}</strong><span>{label}</span>{overrideCount > 0 && <em>{overrideCount} 项开通日期已单独覆盖</em>}</div>
    <input aria-label={`${name || '事件'}${state === 'open' ? '开通' : '停运'}日期`} type="date" value={date} onChange={event => onChange(legacy ? updateOpeningPhase(project, row.phase.id, { openedAt: event.target.value }) : updateOperationEvent(project, row.event.id, { effectiveAt: event.target.value }))} />
    {legacy && <button onClick={() => onStartDrawing(row.phase.id, row.phase.lineId, endpoint)}>继续绘制</button>}
    <button className="danger" onClick={() => onChange(legacy ? deleteOpeningPhase(project, row.phase.id) : deleteOperationEvent(project, row.event.id))}>删除事件</button>
  </div>
}

function StationOptions({ project, line }: { project: ActualRouteProject; line: Line }) {
  return <>{[...new Set(line.stationSequence)].map(id => <option key={id} value={id}>{project.stations.find(station => station.id === id)?.name ?? id}</option>)}</>
}
function phaseStations(project: ActualRouteProject, segmentIds: string[]) {
  const segments = segmentIds.map(id => project.geometry.segments.find(segment => segment.id === id)).filter(Boolean)
  if (!segments.length) return []
  const degree = new Map<string, number>()
  for (const segment of segments) for (const id of [segment!.fromStationId, segment!.toStationId]) degree.set(id, (degree.get(id) ?? 0) + 1)
  const endpoints = [...degree].filter(([, value]) => value === 1).map(([id]) => id)
  return endpoints.length ? endpoints : [...degree.keys()].slice(0, 2)
}
function rowDate(row: HistoryRow) { return row.kind === 'phase' ? row.phase.openedAt : row.event.effectiveAt }
function rowStateOrder(row: HistoryRow) { return row.kind === 'event' && row.event.state === 'closed' ? 1 : 0 }
function rowId(row: HistoryRow) { return row.kind === 'phase' ? `phase:${row.phase.id}` : `event:${row.event.id}` }
''')

# ---- parser round-trip -------------------------------------------------------
replace_once(
    'src/import-export/projectJsonLegacy.ts',
    "import { normalizeTransferStyles } from '../data/transferStyles'",
    "import { normalizeTransferStyles } from '../data/transferStyles'\nimport { normalizeOperationEvents, normalizeOperationHistory } from '../data/operationEvents'",
)
replace_once(
    'src/import-export/projectJsonLegacy.ts',
    "  const normalizedLineLegend = normalizeLineLegend((parsed as Record<string, unknown>).lineLegend)",
    "  const normalizedLineLegend = normalizeLineLegend((parsed as Record<string, unknown>).lineLegend)\n  const normalizedOperationEvents = normalizeOperationEvents((parsed as Record<string, unknown>).operationEvents)",
)
# normalize histories after main object assembly, avoiding invasive map rewrites
replace_once(
    'src/import-export/projectJsonLegacy.ts',
    "    openingPhases: Array.isArray(parsed.openingPhases) ? parsed.openingPhases.map(phase => ({ id: String(phase.id), lineId: String(phase.lineId), name: typeof phase.name === 'string' ? phase.name : undefined, openedAt: normalizeRequiredDate(phase.openedAt, today), segmentIds:",
    "    openingPhases: Array.isArray(parsed.openingPhases) ? parsed.openingPhases.map(phase => ({ id: String(phase.id), lineId: String(phase.lineId), name: typeof phase.name === 'string' ? phase.name : undefined, openedAt: normalizeRequiredDate(phase.openedAt, today), segmentIds:",
)
replace_once(
    'src/import-export/projectJsonLegacy.ts',
    "    geometry: { segments: parsed.geometry.segments.map(segment => ({ ...segment,",
    "    ...(normalizedOperationEvents ? { operationEvents: normalizedOperationEvents } : {}),\n    geometry: { segments: parsed.geometry.segments.map(segment => ({ ...segment,",
)
replace_once(
    'src/import-export/projectJsonLegacy.ts',
    "  for (const phase of project.openingPhases) {",
    "  for (const line of project.lines) { const history = normalizeOperationHistory(line.operationHistory); if (history) line.operationHistory = history; else delete line.operationHistory }\n  for (const relation of project.stationLineRelations) { const history = normalizeOperationHistory(relation.operationHistory); if (history) relation.operationHistory = history; else delete relation.operationHistory }\n  for (const segment of project.geometry.segments) { const history = normalizeOperationHistory(segment.operationHistory); if (history) segment.operationHistory = history; else delete segment.operationHistory }\n  for (const phase of project.openingPhases) {",
)

# ---- active timeline ---------------------------------------------------------
write('src/timeline/active.ts', r'''import type { ActualRouteProject, ISODate, Line, Segment, StationLineRelation } from '../data/model'
import { collapseLinesByServiceFamily, getRootLineId } from '../data/lineIdentity'
import { getCompoundStationCanonical, getCompoundStationRelations } from '../data/compoundStation'
import { resolveSegmentLineAt } from '../data/segmentLineHistory'
import { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'
export { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'

/** Legacy single-interval helper retained for import/tests. New runtime visibility uses operation-history aware helpers below. */
export function isActiveAt(openedAt: ISODate | undefined, closedAt: ISODate | undefined, time: string) {
  return (!openedAt || openedAt <= time) && (!closedAt || time < closedAt)
}
function compareRelations(project: ActualRouteProject, stationId: string, a: string, b: string) {
  const relation = (lineId: string): StationLineRelation | undefined => getCompoundStationRelations(project, stationId).find(item => item.lineId === lineId)
  const ra = relation(a), rb = relation(b)
  const dateOrder = (ra?.openedAt ?? '0000-00-00').localeCompare(rb?.openedAt ?? '0000-00-00')
  return dateOrder || ((project.lines.find(line => line.id === a)?.lineOrder ?? 0) - (project.lines.find(line => line.id === b)?.lineOrder ?? 0))
}
export function isStationHistoricallyActive(project: ActualRouteProject, stationId: string, time: string) {
  return getCompoundStationRelations(project, stationId).some(relation => isRelationOperationalAt(relation, time) && Boolean(project.lines.find(line => line.id === relation.lineId && line.visible && isLineOperationalAt(line, time))))
}
export function getActiveLinesAtStation(project: ActualRouteProject, stationId: string, time: string): Line[] {
  const relationByLine = new Map<string, StationLineRelation>()
  for (const relation of getCompoundStationRelations(project, stationId)) if (!relationByLine.has(relation.lineId) && isRelationOperationalAt(relation, time)) relationByLine.set(relation.lineId, relation)
  return [...relationByLine.values()]
    .map(relation => project.lines.find(line => line.id === relation.lineId))
    .filter((line): line is Line => Boolean(line && line.visible && isLineOperationalAt(line, time)))
    .sort((a, b) => compareRelations(project, stationId, a.id, b.id))
}
export function getPassengerLinesAtStation(project: ActualRouteProject, stationId: string, time: string): Line[] {
  return collapseLinesByServiceFamily(project, getActiveLinesAtStation(project, stationId, time))
}
export function getPassengerVisibleRelationIds(project: ActualRouteProject, stationId: string, time: string, lineIds?: string[]): string[] {
  const ids = lineIds ?? getActiveLinesAtStation(project, stationId, time).map(line => line.id)
  const representativeFamilies = new Set(ids.map(id => project.lines.find(line => line.id === id)).filter((line): line is Line => Boolean(line)).map(line => getRootLineId(project, line)))
  return getCompoundStationRelations(project, stationId)
    .filter(relation => {
      const relationLine = project.lines.find(line => line.id === relation.lineId)
      return Boolean(relationLine && representativeFamilies.has(getRootLineId(project, relationLine)) && isRelationOperationalAt(relation, time))
    })
    .map(relation => relation.id)
}
export function getFirstLineAtStation(project: ActualRouteProject, stationId: string) {
  const ids = getCompoundStationRelations(project, stationId).map(relation => relation.lineId)
  return project.lines.filter(line => ids.includes(line.id)).sort((a, b) => compareRelations(project, stationId, a.id, b.id))[0]
}
export function getOrientationAnchorLine(project: ActualRouteProject, stationId: string, time: string) {
  const station = project.stations.find(item => item.id === stationId)
  const anchor = station?.orientationAnchorLineId ? project.lines.find(line => line.id === station.orientationAnchorLineId) : getFirstLineAtStation(project, stationId)
  if (anchor && getCompoundStationRelations(project, stationId).some(relation => relation.lineId === anchor.id)) return anchor
  return getActiveLinesAtStation(project, stationId, time)[0]
}
export type ActiveSegment = Segment & { effectiveLineIdAtCurrentDate: string }
export function getActiveNetworkAtTime(project: ActualRouteProject, time: string) {
  const lines = project.lines.filter(line => line.visible && isLineOperationalAt(line, time))
  const lineIds = new Set(lines.map(line => line.id))
  const relations = project.stationLineRelations.filter(relation => lineIds.has(relation.lineId) && isRelationOperationalAt(relation, time))
  const canonicalIds = new Set<string>()
  for (const relation of relations) canonicalIds.add(getCompoundStationCanonical(project, relation.stationId)?.id ?? relation.stationId)
  const stations = project.stations.filter(station => canonicalIds.has(station.id))
  const segments = project.geometry.segments.flatMap(segment => {
    if (!isSegmentOperationalAt(segment, time)) return []
    const effectiveLineIdAtCurrentDate = resolveSegmentLineAt(segment, time)
    if (!lineIds.has(effectiveLineIdAtCurrentDate)) return []
    return [{ ...segment, lineId: effectiveLineIdAtCurrentDate, effectiveLineIdAtCurrentDate }]
  })
  return { lines, stations, relations, segments }
}
''')

# Tangent/station marker filtering must use repeated-operation state.
replace_once('src/geometry/tangent.ts', "import { getOrientationAnchorLine, isActiveAt } from '../timeline/active'", "import { getOrientationAnchorLine, isLineOperationalAt, isRelationOperationalAt } from '../timeline/active'")
replace_once('src/geometry/tangent.ts', ".filter(relation => visibleIdSet ? visibleIdSet.has(relation.id) : isActiveAt(relation.openedAt, relation.closedAt, time))", ".filter(relation => visibleIdSet ? visibleIdSet.has(relation.id) : isRelationOperationalAt(relation, time))")
replace_once('src/geometry/tangent.ts', "return Boolean(line && line.visible && isActiveAt(line.openedAt, line.closedAt, time))", "return Boolean(line && line.visible && isLineOperationalAt(line, time))")

# ---- presentation compiler: repeated open/close events ----------------------
replace_once('src/presentation/compiler.ts', "import { getCompoundStationMemberIds } from '../data/compoundStation'", "import { getCompoundStationMemberIds } from '../data/compoundStation'\nimport { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'")
replace_once(
    'src/presentation/compiler.ts',
    "  for (const segment of project.geometry.segments) {\n    const date = openDate(project, segment)\n    if (!validDate(date) || date < start || date > end) continue\n    const openingLineId = resolveSegmentLineAt(segment, date)\n    const phase = project.openingPhases.find(item => item.lineId === openingLineId && item.openedAt === date && item.segmentIds.includes(segment.id) && !item.overriddenSegmentIds?.includes(segment.id))\n    const key = `${date}\\u0000${openingLineId}\\u0000${phase?.id ?? ''}`\n    openings.set(key, [...(openings.get(key) ?? []), segment])\n  }",
    "  for (const segment of project.geometry.segments) {\n    const date = openDate(project, segment)\n    if (validDate(date) && date >= start && date <= end) {\n      const openingLineId = resolveSegmentLineAt(segment, date)\n      const phase = project.openingPhases.find(item => item.lineId === openingLineId && item.openedAt === date && item.segmentIds.includes(segment.id) && !item.overriddenSegmentIds?.includes(segment.id))\n      const key = `${date}\\u0000${openingLineId}\\u0000${phase?.id ?? ''}`\n      openings.set(key, [...(openings.get(key) ?? []), segment])\n    }\n    for (const entry of segment.operationHistory ?? []) if (entry.state === 'open' && validDate(entry.effectiveAt) && entry.effectiveAt >= start && entry.effectiveAt <= end) {\n      const openingLineId = resolveSegmentLineAt(segment, entry.effectiveAt)\n      const key = `${entry.effectiveAt}\\u0000${openingLineId}\\u0000op:${entry.eventId ?? entry.id}`\n      openings.set(key, [...(openings.get(key) ?? []), segment])\n    }\n  }",
)
replace_once('src/presentation/compiler.ts', "    const [historyDate, lineId, openingPhaseId] = key.split('\\u0000')\n    const phase = openingPhaseId ? project.openingPhases.find(item => item.id === openingPhaseId) : undefined\n    const earlier = project.geometry.segments.filter(segment => validDate(openDate(project, segment)) && openDate(project, segment) < historyDate && resolveSegmentLineAt(segment, previousDate(historyDate)) === lineId)", "    const [historyDate, lineId, openingGroupId] = key.split('\\u0000')\n    const phase = openingGroupId && !openingGroupId.startsWith('op:') ? project.openingPhases.find(item => item.id === openingGroupId) : undefined\n    const earlier = project.geometry.segments.filter(segment => isSegmentOperationalAt(segment, previousDate(historyDate)) && resolveSegmentLineAt(segment, previousDate(historyDate)) === lineId)")
replace_once('src/presentation/compiler.ts', "      events.push({ id: `${historyDate}-${lineId}-${openingPhaseId || 'legacy'}-${componentIndex}`, type, eventTypes, historyDate, lineId, openingPhaseId: openingPhaseId || undefined, segmentIds: component.map(segment => segment.id), stationIds, interchangeStationIds, branches })", "      events.push({ id: `${historyDate}-${lineId}-${openingGroupId || 'legacy'}-${componentIndex}`, type, eventTypes, historyDate, lineId, openingPhaseId: phase?.id, segmentIds: component.map(segment => segment.id), stationIds, interchangeStationIds, branches })")
# station-only reopen entries
replace_once(
    'src/presentation/compiler.ts',
    "  for (const segment of project.geometry.segments) if (validDate(segment.closedAt) && segment.closedAt >= start && segment.closedAt <= end) events.push({ id: `${segment.closedAt}-${segment.lineId}-close-${segment.id}`, type: 'SEGMENT_CLOSURE', eventTypes: ['SEGMENT_CLOSURE'], historyDate: segment.closedAt, lineId: segment.lineId, segmentIds: [segment.id], stationIds: [], interchangeStationIds: [], branches: [] })",
    "  for (const relation of project.stationLineRelations) for (const entry of relation.operationHistory ?? []) if (entry.state === 'open' && validDate(entry.effectiveAt) && entry.effectiveAt >= start && entry.effectiveAt <= end && !covered.has(`${entry.effectiveAt}\\u0000${relation.lineId}\\u0000${relation.stationId}`)) { const before=activeLineIds(project,relation.stationId,previousDate(entry.effectiveAt)).length,after=activeLineIds(project,relation.stationId,entry.effectiveAt).length,interchangeStationIds=after>=2&&after>before?[relation.stationId]:[]; events.push({ id: `${entry.effectiveAt}-${relation.lineId}-station-reopen-${relation.stationId}-${entry.id}`, type: 'STATION_OPENING', eventTypes: ['STATION_OPENING', ...(interchangeStationIds.length ? ['INTERCHANGE_CREATED' as const] : [])], historyDate: entry.effectiveAt, lineId: relation.lineId, segmentIds: [], stationIds: [relation.stationId], interchangeStationIds, branches: [] }) }\n  for (const segment of project.geometry.segments) if (validDate(segment.closedAt) && segment.closedAt >= start && segment.closedAt <= end) events.push({ id: `${segment.closedAt}-${segment.lineId}-close-${segment.id}`, type: 'SEGMENT_CLOSURE', eventTypes: ['SEGMENT_CLOSURE'], historyDate: segment.closedAt, lineId: segment.lineId, segmentIds: [segment.id], stationIds: [], interchangeStationIds: [], branches: [] })\n  const operationClosures = new Map<string, Segment[]>()\n  for (const segment of project.geometry.segments) for (const entry of segment.operationHistory ?? []) if (entry.state === 'closed' && validDate(entry.effectiveAt) && entry.effectiveAt >= start && entry.effectiveAt <= end) { const key=`${entry.effectiveAt}\\u0000${resolveSegmentLineAt(segment,entry.effectiveAt)}\\u0000${entry.eventId ?? entry.id}`; operationClosures.set(key,[...(operationClosures.get(key)??[]),segment]) }\n  for (const [key,segments] of operationClosures) { const [historyDate,lineId,eventId]=key.split('\\u0000'),meta=project.operationEvents?.find(item=>item.id===eventId); for (const [componentIndex,component] of connectedComponents(segments).entries()) { const stationIds=(meta?.stationRelationIds??[]).map(id=>project.stationLineRelations.find(item=>item.id===id)?.stationId).filter((id):id is string=>Boolean(id)); const type=meta?.affectsLine?'LINE_CLOSURE':'SEGMENT_CLOSURE'; events.push({ id:`${historyDate}-${lineId}-operation-close-${eventId}-${componentIndex}`,type,eventTypes:[type],historyDate,lineId,segmentIds:component.map(segment=>segment.id),stationIds,interchangeStationIds:[],branches:[] }) } }",
)
replace_once('src/presentation/compiler.ts', "function activeLinesForAllStations(project: ActualRouteProject, date: string) { const lines = new Map(project.lines.map(line => [line.id, line])), result: Record<string, string[]> = {}; for (const relation of project.stationLineRelations) { const line = lines.get(relation.lineId); if (!line || !isOpenAt(relation.openedAt, relation.closedAt, date) || !isOpenAt(line.openedAt, line.closedAt, date)) continue; result[relation.stationId] = [...(result[relation.stationId] ?? []), line.id] } for (const ids of Object.values(result)) ids.sort((a, b) => compareLines(lines.get(a), lines.get(b))); return result }", "function activeLinesForAllStations(project: ActualRouteProject, date: string) { const lines = new Map(project.lines.map(line => [line.id, line])), result: Record<string, string[]> = {}; for (const relation of project.stationLineRelations) { const line = lines.get(relation.lineId); if (!line || !isRelationOperationalAt(relation,date) || !isLineOperationalAt(line,date)) continue; result[relation.stationId] = [...(result[relation.stationId] ?? []), line.id] } for (const ids of Object.values(result)) ids.sort((a, b) => compareLines(lines.get(a), lines.get(b))); return result }")
replace_once('src/presentation/compiler.ts', "function stationOpensAt(project: ActualRouteProject, stationId: string, lineId: string, date: string) { const relation = project.stationLineRelations.find(item => item.stationId === stationId && item.lineId === lineId); return (relation?.openedAt || project.stations.find(item => item.id === stationId)?.openedAt || date) === date }", "function stationOpensAt(project: ActualRouteProject, stationId: string, lineId: string, date: string) { const relation = project.stationLineRelations.find(item => item.stationId === stationId && item.lineId === lineId); return relation?.operationHistory?.some(entry=>entry.state==='open'&&entry.effectiveAt===date) || (relation?.openedAt || project.stations.find(item => item.id === stationId)?.openedAt || date) === date }")
replace_once('src/presentation/compiler.ts', "function activeLineIds(project: ActualRouteProject, stationId: string, date: string) { const memberIds = new Set(getCompoundStationMemberIds(project, stationId)); return project.stationLineRelations.filter(relation => memberIds.has(relation.stationId) && isOpenAt(relation.openedAt, relation.closedAt, date) && isOpenAt(project.lines.find(line => line.id === relation.lineId)?.openedAt, project.lines.find(line => line.id === relation.lineId)?.closedAt, date)).map(relation => relation.lineId) }", "function activeLineIds(project: ActualRouteProject, stationId: string, date: string) { const memberIds = new Set(getCompoundStationMemberIds(project, stationId)); return project.stationLineRelations.filter(relation => memberIds.has(relation.stationId) && isRelationOperationalAt(relation,date) && isLineOperationalAt(project.lines.find(line => line.id === relation.lineId),date)).map(relation => relation.lineId) }")

# ---- presentation engine static state + repeated lifecycle ------------------
replace_once('src/presentation/engine.ts', "import { getCompoundStationMemberIds, getCompoundStationRelations, getPassengerStationIdentity, isCompoundStationCanonical } from '../data/compoundStation'", "import { getCompoundStationMemberIds, getCompoundStationRelations, getPassengerStationIdentity, isCompoundStationCanonical } from '../data/compoundStation'\nimport { isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'")
regex_once(
    'src/presentation/engine.ts',
    r"  const segmentStates: PresentationState\['segmentStates'\] = \{\}\n  for \(const segment of project\.geometry\.segments\) \{.*?\n  \}\n\n  const stationStates:",
    r'''  const segmentStates: PresentationState['segmentStates'] = {}
  for (const segment of project.geometry.segments) {
    const historicalLineId = sequence.cache.segmentLineIdsByDate[historyDate]?.[segment.id] ?? resolveSegmentLineAt(segment, historyDate)
    const currentOpening = Boolean(currentBeat?.segmentIds.includes(segment.id) && currentBeat.eventTypes.includes('SEGMENT_OPENING'))
    const currentClosure = Boolean(currentBeat?.segmentIds.includes(segment.id) && (currentBeat.eventTypes.includes('SEGMENT_CLOSURE') || currentBeat.eventTypes.includes('LINE_CLOSURE')))
    let revealProgress = isSegmentOperationalAt(segment, historyDate) ? 1 : 0
    let opacity = revealProgress
    let revealFrom: 'from' | 'to' = 'from'
    if (currentOpening && currentBeat) {
      revealProgress = beatSegmentProgress(currentBeat, segment.id, time)
      opacity = revealProgress > 0 ? 1 : 0
      revealFrom = beatSegmentDirection(currentBeat, segment.id, segment.fromStationId)
    } else if (currentClosure && currentBeat) {
      revealProgress = 1
      opacity = time < currentBeat.revealStart ? 1 : 1 - easing.transfer(clamp((time - currentBeat.revealStart) / Math.max(.000001, currentBeat.revealDuration)))
      if (time >= currentBeat.revealEnd) { revealProgress = 0; opacity = 0 }
    } else if (revealProgress > 0) {
      const priorOpening = [...sequence.beats].reverse().find(beat => beat.historyDate <= historyDate && beat.segmentIds.includes(segment.id) && beat.eventTypes.includes('SEGMENT_OPENING'))
      if (priorOpening) revealFrom = beatSegmentDirection(priorOpening, segment.id, segment.fromStationId)
    }
    segmentStates[segment.id] = { lineId: historicalLineId, revealProgress, revealFrom, opacity, strokeDashoffset: (revealFrom === 'from' ? 1 : -1) * (1 - revealProgress) }
  }

  const stationStates:''',
)
replace_once('src/presentation/engine.ts', "&& active(relation.openedAt, relation.closedAt, date)", "&& isRelationOperationalAt(relation, date)")

# ---- tests ------------------------------------------------------------------
write('src/data/operationEvents.test.ts', r'''import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getOpeningPhasePathCandidates } from './openingPhases'
import { createOperationEvent, deleteOperationEvent, isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt, resolveOperationState, updateOperationEvent } from './operationEvents'

function project() { return structuredClone(demoProject) }

describe('repeated operation history', () => {
  it('supports open -> close -> reopen -> close on the same complete station interval', () => {
    let current = project()
    const path = getOpeningPhasePathCandidates(current, 'line-a', 's2', 's4')[0]
    const close = createOperationEvent(current, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }); current = close.project
    const reopen = createOperationEvent(current, { lineId: 'line-a', effectiveAt: '2035-06-01', state: 'open', path }); current = reopen.project
    current = createOperationEvent(current, { lineId: 'line-a', effectiveAt: '2040-01-01', state: 'closed', path }).project
    const segment = current.geometry.segments.find(item => item.id === 'a-2')!
    expect(isSegmentOperationalAt(segment, '2029-12-31')).toBe(true)
    expect(isSegmentOperationalAt(segment, '2030-01-01')).toBe(false)
    expect(isSegmentOperationalAt(segment, '2035-06-01')).toBe(true)
    expect(isSegmentOperationalAt(segment, '2040-01-01')).toBe(false)
    expect(segment.operationHistory?.map(entry => entry.state)).toEqual(['closed', 'open', 'closed'])
    expect(current.operationEvents).toHaveLength(3)
    expect(isLineOperationalAt(current.lines.find(item => item.id === 'line-a'), '2035-06-01')).toBe(true)
  })

  it('makes closure win over opening on the same date, regardless of insertion order', () => {
    expect(resolveOperationState(undefined, undefined, [
      { id: 'close', effectiveAt: '2030-01-01', state: 'closed' },
      { id: 'open', effectiveAt: '2030-01-01', state: 'open' },
    ], '2030-01-01')).toBe(false)
    expect(resolveOperationState(undefined, undefined, [
      { id: 'open', effectiveAt: '2030-01-01', state: 'open' },
      { id: 'close', effectiveAt: '2030-01-01', state: 'closed' },
    ], '2030-01-01')).toBe(false)
  })

  it('allows a later opening event to restore service after closure', () => {
    expect(resolveOperationState('2020-01-01', '2030-01-01', [{ id: 'reopen', effectiveAt: '2035-01-01', state: 'open' }], '2036-01-01')).toBe(true)
  })

  it('does not close a boundary station relation when another incident segment remains active', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const result = createOperationEvent(base, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path })
    const s2 = result.project.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')!
    const s3 = result.project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!
    expect(s2.operationHistory).toBeUndefined()
    expect(isRelationOperationalAt(s2, '2031-01-01')).toBe(true)
    expect(isRelationOperationalAt(s3, '2031-01-01')).toBe(false)
  })

  it('updates and deletes an event atomically across every target history', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const created = createOperationEvent(base, { lineId: 'line-a', name: '复开', effectiveAt: '2035-01-01', state: 'open', path })
    const updated = updateOperationEvent(created.project, created.eventId, { effectiveAt: '2036-01-01', name: '恢复运营' })
    expect(updated.operationEvents?.[0].effectiveAt).toBe('2036-01-01')
    expect(updated.geometry.segments.find(item => item.id === 'a-2')?.operationHistory?.[0].effectiveAt).toBe('2036-01-01')
    const deleted = deleteOperationEvent(updated, created.eventId)
    expect(deleted.operationEvents).toBeUndefined()
    expect(deleted.geometry.segments.find(item => item.id === 'a-2')?.operationHistory).toBeUndefined()
  })
})
''')

# Append focused network regression.
active_test = read('src/timeline/active.test.ts')
needle = "})\n"
if not active_test.endswith(needle): raise RuntimeError('active.test.ts ending changed')
active_insert = r'''

  it('reopens a previously closed segment through operation history', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments[0]
    segment.closedAt = '2030-01-01'
    segment.operationHistory = [{ id: 'reopen', effectiveAt: '2035-01-01', state: 'open' }]
    const line = project.lines.find(item => item.id === segment.lineId)!
    line.closedAt = '2030-01-01'
    line.operationHistory = [{ id: 'line-reopen', effectiveAt: '2035-01-01', state: 'open' }]
    expect(getActiveNetworkAtTime(project, '2031-01-01').segments.some(item => item.id === segment.id)).toBe(false)
    expect(getActiveNetworkAtTime(project, '2035-01-01').segments.some(item => item.id === segment.id)).toBe(true)
  })
'''
write('src/timeline/active.test.ts', active_test[:-3] + active_insert + '})\n')

# Round-trip persistence of the new event/history schema.
json_test = read('src/import-export/export.test.ts')
if not json_test.endswith('})\n'): raise RuntimeError('export.test.ts ending changed')
json_insert = r'''

  it('round-trips repeated operation events and object operation history', () => {
    const project = structuredClone(demoProject)
    project.operationEvents = [{ id: 'event-reopen', lineId: 'line-a', effectiveAt: '2035-01-01', state: 'open', segmentIds: ['a-1'], stationRelationIds: [], affectsLine: true }]
    project.geometry.segments.find(item => item.id === 'a-1')!.operationHistory = [{ id: 'state-reopen', eventId: 'event-reopen', effectiveAt: '2035-01-01', state: 'open' }]
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.operationEvents?.[0]).toMatchObject({ id: 'event-reopen', state: 'open', effectiveAt: '2035-01-01' })
    expect(restored.geometry.segments.find(item => item.id === 'a-1')?.operationHistory?.[0]).toMatchObject({ eventId: 'event-reopen', state: 'open' })
  })
'''
write('src/import-export/export.test.ts', json_test[:-3] + json_insert + '})\n')

replace_once('src/build.ts', "export const BUILD_VERSION = '2026-09-14-operation-history-81'", "export const BUILD_VERSION = '2026-09-14-repeated-operation-history-81-1'")

print('Build81.1 repeated operation history patch applied')
