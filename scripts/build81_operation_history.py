from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one exact match, found {count}')
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {count}')
    write(path, next_text)


OPENING_PHASES = r'''import type { ActualRouteProject, OpeningPhase, OperationEventType, Segment } from './model'
import { uid } from './model'

export interface OpeningPhasePath { segmentIds: string[]; stationIds: string[] }
export interface CreateOpeningPhaseInput { lineId: string; name?: string; openedAt: string; eventType?: OperationEventType; path?: OpeningPhasePath; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean }

export function getOperationEventType(phase: OpeningPhase): OperationEventType { return phase.eventType === 'close' ? 'close' : 'open' }
export function getOperationEventDate(phase: OpeningPhase): string { return phase.openedAt }

export function getOpeningPhasePathCandidates(project: ActualRouteProject, lineId: string, startStationId: string, endStationId: string): OpeningPhasePath[] {
  if (!startStationId || !endStationId || startStationId === endStationId) return []
  const segments = project.geometry.segments.filter(segment => segment.lineId === lineId)
  const adjacency = new Map<string, Segment[]>()
  for (const segment of segments) for (const stationId of [segment.fromStationId, segment.toStationId]) adjacency.set(stationId, [...(adjacency.get(stationId) ?? []), segment])
  const results: OpeningPhasePath[] = []
  const visit = (stationId: string, stationIds: string[], segmentIds: string[]) => {
    if (results.length >= 16) return
    if (stationId === endStationId) { results.push({ stationIds, segmentIds }); return }
    for (const segment of stableSegments(project, adjacency.get(stationId) ?? [])) {
      if (segmentIds.includes(segment.id)) continue
      const nextId = segment.fromStationId === stationId ? segment.toStationId : segment.fromStationId
      if (stationIds.includes(nextId)) continue
      visit(nextId, [...stationIds, nextId], [...segmentIds, segment.id])
    }
  }
  visit(startStationId, [startStationId], [])
  return results.sort((a, b) => a.segmentIds.length - b.segmentIds.length || a.segmentIds.join().localeCompare(b.segmentIds.join()))
}

export function createOpeningPhase(project: ActualRouteProject, input: CreateOpeningPhaseInput): { project: ActualRouteProject; phaseId: string } {
  const next = structuredClone(project)
  const phaseId = uid('phase')
  const path = input.path ?? { segmentIds: [], stationIds: [] }
  const eventType: OperationEventType = input.eventType === 'close' ? 'close' : 'open'
  const segmentSet = new Set(path.segmentIds)
  const stationRelationIds = path.stationIds.flatMap(stationId => {
    const relation = next.stationLineRelations.find(item => item.stationId === stationId && item.lineId === input.lineId)
    if (!relation) return []
    const keepExisting = eventType === 'open'
      ? isExistingConnection(next, input.lineId, stationId, segmentSet, input.openedAt)
      : remainsConnectedAfterClosure(next, input.lineId, stationId, segmentSet, input.openedAt)
    return keepExisting ? [] : [relation.id]
  })
  const phase: OpeningPhase = { id: phaseId, lineId: input.lineId, name: input.name?.trim() || undefined, openedAt: input.openedAt, ...(eventType === 'close' ? { eventType } : {}), revealStartStationId: input.revealStartStationId ?? path.stationIds[0], revealEndStationId: input.revealEndStationId ?? path.stationIds.at(-1), showOverviewAfter: input.showOverviewAfter === true, segmentIds: [...path.segmentIds], stationRelationIds, overriddenSegmentIds: [], overriddenStationRelationIds: [] }
  next.openingPhases.push(phase)
  synchronizeOpeningPhase(next, phase)
  syncLineOpeningDate(next, input.lineId)
  return { project: next, phaseId }
}

export function updateOpeningPhase(project: ActualRouteProject, phaseId: string, patch: { name?: string; openedAt?: string; showOverviewAfter?: boolean }): ActualRouteProject {
  const next = structuredClone(project)
  const phase = next.openingPhases.find(item => item.id === phaseId)
  if (!phase) return project
  if (patch.name !== undefined) phase.name = patch.name.trim() || undefined
  if (patch.openedAt) phase.openedAt = patch.openedAt
  if (patch.showOverviewAfter !== undefined) phase.showOverviewAfter = patch.showOverviewAfter
  synchronizeOpeningPhase(next, phase)
  syncLineOpeningDate(next, phase.lineId)
  return next
}

export function deleteOpeningPhase(project: ActualRouteProject, phaseId: string): ActualRouteProject {
  const next = structuredClone(project)
  const lineId = next.openingPhases.find(item => item.id === phaseId)?.lineId
  next.openingPhases = next.openingPhases.filter(item => item.id !== phaseId)
  if (lineId) syncLineOpeningDate(next, lineId)
  return next
}

export function assignCreatedObjectsToPhase(project: ActualRouteProject, phaseId: string | undefined, segmentIds: string[], stationRelationIds: string[]): void {
  if (!phaseId) return
  const phase = project.openingPhases.find(item => item.id === phaseId)
  if (!phase || getOperationEventType(phase) !== 'open') return
  for (const segmentId of segmentIds) if (!phase.segmentIds.includes(segmentId)) phase.segmentIds.push(segmentId)
  for (const relationId of stationRelationIds) if (!phase.stationRelationIds.includes(relationId)) phase.stationRelationIds.push(relationId)
  synchronizeOpeningPhase(project, phase)
}

export function getOpeningPhaseDate(project: ActualRouteProject, phaseId: string | undefined): string | null {
  if (!phaseId) return null
  const phase = project.openingPhases.find(item => item.id === phaseId)
  return phase && getOperationEventType(phase) === 'open' ? phase.openedAt : null
}

export function markSegmentDateOverride(project: ActualRouteProject, segmentId: string, eventType: OperationEventType = 'open'): void {
  for (const phase of project.openingPhases) if (getOperationEventType(phase) === eventType && phase.segmentIds.includes(segmentId) && !phase.overriddenSegmentIds?.includes(segmentId)) phase.overriddenSegmentIds = [...(phase.overriddenSegmentIds ?? []), segmentId]
}

export function clearSegmentDateOverride(project: ActualRouteProject, segmentId: string, eventType: OperationEventType = 'open'): void {
  for (const phase of project.openingPhases) {
    if (getOperationEventType(phase) !== eventType || !phase.segmentIds.includes(segmentId)) continue
    phase.overriddenSegmentIds = (phase.overriddenSegmentIds ?? []).filter(id => id !== segmentId)
    const segment = project.geometry.segments.find(item => item.id === segmentId)
    if (segment) setObjectDate(segment, eventType, phase.openedAt)
  }
}

export function markRelationDateOverride(project: ActualRouteProject, relationId: string, eventType: OperationEventType = 'open'): void {
  for (const phase of project.openingPhases) if (getOperationEventType(phase) === eventType && phase.stationRelationIds.includes(relationId) && !phase.overriddenStationRelationIds?.includes(relationId)) phase.overriddenStationRelationIds = [...(phase.overriddenStationRelationIds ?? []), relationId]
}

/** Restores one station-line relation's inherited date without creating another source of truth. */
export function clearRelationDateOverride(project: ActualRouteProject, relationId: string, eventType: OperationEventType = 'open'): void {
  for (const phase of project.openingPhases) {
    if (getOperationEventType(phase) !== eventType || !phase.stationRelationIds.includes(relationId)) continue
    phase.overriddenStationRelationIds = (phase.overriddenStationRelationIds ?? []).filter(id => id !== relationId)
    const relation = project.stationLineRelations.find(item => item.id === relationId)
    if (relation) setObjectDate(relation, eventType, phase.openedAt)
  }
}

export function phaseForSegment(project: ActualRouteProject, segmentId: string, eventType: OperationEventType = 'open') { return project.openingPhases.find(phase => getOperationEventType(phase) === eventType && phase.segmentIds.includes(segmentId)) }
export function phaseForRelation(project: ActualRouteProject, relationId: string, eventType: OperationEventType = 'open') { return project.openingPhases.find(phase => getOperationEventType(phase) === eventType && phase.stationRelationIds.includes(relationId)) }

function synchronizeOpeningPhase(project: ActualRouteProject, phase: OpeningPhase) {
  const eventType = getOperationEventType(phase)
  const segmentOverrides = new Set(phase.overriddenSegmentIds ?? [])
  const relationOverrides = new Set(phase.overriddenStationRelationIds ?? [])
  for (const segmentId of phase.segmentIds) if (!segmentOverrides.has(segmentId)) { const segment = project.geometry.segments.find(item => item.id === segmentId); if (segment) setObjectDate(segment, eventType, phase.openedAt) }
  for (const relationId of phase.stationRelationIds) if (!relationOverrides.has(relationId)) { const relation = project.stationLineRelations.find(item => item.id === relationId); if (relation) setObjectDate(relation, eventType, phase.openedAt) }
}

function setObjectDate(target: { openedAt?: string | null; closedAt?: string | null }, eventType: OperationEventType, date: string) {
  if (eventType === 'close') target.closedAt = date
  else target.openedAt = date
}

function syncLineOpeningDate(project: ActualRouteProject, lineId: string) {
  const line = project.lines.find(item => item.id === lineId)
  if (!line) return
  const dates = project.openingPhases.filter(phase => phase.lineId === lineId && getOperationEventType(phase) === 'open').map(phase => phase.openedAt).filter(Boolean).sort()
  if (dates.length) line.openedAt = dates[0]
}

function isExistingConnection(project: ActualRouteProject, lineId: string, stationId: string, selected: Set<string>, phaseDate: string) {
  const relation = project.stationLineRelations.find(item => item.stationId === stationId && item.lineId === lineId)
  if (!relation?.openedAt || relation.openedAt >= phaseDate) return false
  return project.geometry.segments.some(segment => segment.lineId === lineId && !selected.has(segment.id) && (segment.fromStationId === stationId || segment.toStationId === stationId) && Boolean(segment.openedAt && segment.openedAt < phaseDate))
}

function remainsConnectedAfterClosure(project: ActualRouteProject, lineId: string, stationId: string, selected: Set<string>, closureDate: string) {
  return project.geometry.segments.some(segment => segment.lineId === lineId && !selected.has(segment.id) && (segment.fromStationId === stationId || segment.toStationId === stationId) && (!segment.openedAt || segment.openedAt <= closureDate) && (!segment.closedAt || closureDate < segment.closedAt))
}

function stableSegments(project: ActualRouteProject, segments: Segment[]) {
  const line = segments[0] ? project.lines.find(item => item.id === segments[0].lineId) : undefined
  const index = (stationId: string) => { const value = line?.stationSequence.indexOf(stationId) ?? -1; return value < 0 ? 1e9 : value }
  return [...segments].sort((a, b) => Math.min(index(a.fromStationId), index(a.toStationId)) - Math.min(index(b.fromStationId), index(b.toStationId)) || a.id.localeCompare(b.id))
}
'''

OPENING_PHASE_EDITOR = r'''import { useEffect, useMemo, useState } from 'react'
import type { ActualRouteProject, Line, OpeningPhase, OperationEventType } from '../data/model'
import { createOpeningPhase, deleteOpeningPhase, getOpeningPhasePathCandidates, getOperationEventDate, getOperationEventType, updateOpeningPhase, type OpeningPhasePath } from '../data/openingPhases'

export function OpeningPhaseEditor({ project, line, onChange, onPreview, onStartDrawing }: {
  project: ActualRouteProject
  line: Line
  onChange: (next: ActualRouteProject) => void
  onPreview: (path: OpeningPhasePath | null) => void
  onStartDrawing: (phaseId: string, lineId: string, stationId: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<OperationEventType>('open')
  const [eventDate, setEventDate] = useState(project.timeline.currentDate)
  const [startId, setStartId] = useState(line.stationSequence[0] ?? '')
  const [endId, setEndId] = useState(line.stationSequence.at(-1) ?? '')
  const [candidateIndex, setCandidateIndex] = useState(0)
  const phases = project.openingPhases.filter(phase => phase.lineId === line.id).sort((a, b) => getOperationEventDate(a).localeCompare(getOperationEventDate(b)) || a.id.localeCompare(b.id))
  const candidates = useMemo(() => getOpeningPhasePathCandidates(project, line.id, startId, endId), [project, line.id, startId, endId])
  const candidate = candidates[candidateIndex] ?? candidates[0] ?? null
  useEffect(() => { onPreview(adding ? candidate : null); return () => onPreview(null) }, [adding, candidate, onPreview])
  useEffect(() => { if (candidateIndex >= candidates.length) setCandidateIndex(0) }, [candidateIndex, candidates.length])

  const confirmExisting = () => {
    if (!eventDate || !candidate) return
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt: eventDate, eventType, path: candidate, revealStartStationId: startId, revealEndStationId: endId })
    onChange(result.project); reset()
  }
  const startNewConstruction = () => {
    if (!eventDate || eventType !== 'open') return
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt: eventDate, eventType: 'open', revealStartStationId: startId || undefined })
    onChange(result.project); onStartDrawing(result.phaseId, line.id, startId || null); reset()
  }
  const reset = () => { setAdding(false); setName(''); setEventType('open'); setCandidateIndex(0); onPreview(null) }

  return <section className="opening-phases">
    <div className="opening-phases-title"><strong>运营历史</strong></div>
    {phases.length === 0 && <p className="meta-note">尚未建立运营事件；旧工程中的对象日期仍会正常生效。</p>}
    {phases.map(phase => <PhaseRow key={phase.id} phase={phase} project={project} onChange={onChange} onStartDrawing={onStartDrawing} />)}
    {!adding ? <button onClick={() => setAdding(true)}>＋ 添加运营事件</button> : <div className="opening-phase-form">
      <label className="field"><span>事件类型</span><select value={eventType} onChange={event => setEventType(event.target.value as OperationEventType)}><option value="open">开通</option><option value="close">停运</option></select></label>
      <label className="field"><span>事件名称（可选）</span><input value={name} onChange={event => setName(event.target.value)} placeholder={eventType === 'open' ? '一期 / 东延 / 北延' : '老线停运 / 区间封闭'} /></label>
      <label className="field"><span>{eventType === 'open' ? '开通日期' : '停运日期'}</span><input type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /></label>
      <div className="field-grid"><label className="field"><span>起点</span><select value={startId} onChange={event => { setStartId(event.target.value); setCandidateIndex(0) }}><StationOptions project={project} line={line} /></select></label><label className="field"><span>终点</span><select value={endId} onChange={event => { setEndId(event.target.value); setCandidateIndex(0) }}><StationOptions project={project} line={line} /></select></label></div>
      {candidates.length > 1 && <label className="field phase-warning"><span>存在 {candidates.length} 条候选路径，请选择</span><select value={candidateIndex} onChange={event => setCandidateIndex(Number(event.target.value))}>{candidates.map((path, index) => <option key={path.segmentIds.join('|')} value={index}>候选 {index + 1}：{path.stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' → ')}</option>)}</select></label>}
      {startId && endId && startId !== endId && candidates.length === 0 && <p className="phase-error">当前线路拓扑中找不到连续路径。</p>}
      {candidate && <p className="phase-preview-copy">将设置 {candidate.segmentIds.length} 个完整站间区间、沿途 {candidate.stationIds.length} 个站；样式点不会切开时间范围。</p>}
      <button className="primary" disabled={!candidate || !eventDate} onClick={confirmExisting}>确认并批量设置{eventType === 'open' ? '开通' : '停运'}日期</button>
      {eventType === 'open' && <button disabled={!startId || !eventDate} onClick={startNewConstruction}>从起点开始绘制此开通事件</button>}
      <button onClick={reset}>取消</button>
    </div>}
  </section>
}

function PhaseRow({ phase, project, onChange, onStartDrawing }: { phase: OpeningPhase; project: ActualRouteProject; onChange: (next: ActualRouteProject) => void; onStartDrawing: (phaseId: string, lineId: string, stationId: string | null) => void }) {
  const stationIds = phaseStations(project, phase)
  const label = stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' — ') || '等待绘制成员'
  const overrideCount = (phase.overriddenSegmentIds?.length ?? 0) + (phase.overriddenStationRelationIds?.length ?? 0)
  const endpoint = stationIds.at(-1) ?? null
  const eventType = getOperationEventType(phase)
  const eventLabel = eventType === 'close' ? '停运' : '开通'
  return <div className="opening-phase-row">
    <div><strong>{eventLabel} · {phase.name || '未命名事件'}</strong><span>{label}</span>{overrideCount > 0 && <em>{overrideCount} 项已单独覆盖</em>}</div>
    <input aria-label={`${phase.name || '事件'}${eventLabel}日期`} type="date" value={phase.openedAt} onChange={event => onChange(updateOpeningPhase(project, phase.id, { openedAt: event.target.value }))} />
    {eventType === 'open' && <button onClick={() => onStartDrawing(phase.id, phase.lineId, endpoint)}>继续绘制</button>}
    <button className="danger" onClick={() => onChange(deleteOpeningPhase(project, phase.id))}>删除事件</button>
  </div>
}

function StationOptions({ project, line }: { project: ActualRouteProject; line: Line }) {
  return <>{[...new Set(line.stationSequence)].map(id => <option key={id} value={id}>{project.stations.find(station => station.id === id)?.name ?? id}</option>)}</>
}

function phaseStations(project: ActualRouteProject, phase: OpeningPhase) {
  const segments = phase.segmentIds.map(id => project.geometry.segments.find(segment => segment.id === id)).filter(Boolean)
  if (!segments.length) return []
  const degree = new Map<string, number>()
  for (const segment of segments) for (const id of [segment!.fromStationId, segment!.toStationId]) degree.set(id, (degree.get(id) ?? 0) + 1)
  const endpoints = [...degree].filter(([, value]) => value === 1).map(([id]) => id)
  return endpoints.length ? endpoints : [...degree.keys()].slice(0, 2)
}
'''

write('src/data/openingPhases.ts', OPENING_PHASES)
write('src/components/OpeningPhaseEditor.tsx', OPENING_PHASE_EDITOR)

replace_once(
    'src/data/model.ts',
    "export interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }",
    "export type OperationEventType = 'open' | 'close'\n/** Legacy name retained for project compatibility. openedAt stores the event date; eventType='close' writes that date to closedAt on members. */\nexport interface OpeningPhase { id: string; lineId: string; name?: string; openedAt: string; eventType?: OperationEventType; segmentIds: string[]; stationRelationIds: string[]; revealStartStationId?: string; revealEndStationId?: string; showOverviewAfter?: boolean; overriddenSegmentIds?: string[]; overriddenStationRelationIds?: string[] }",
)

regex_once(
    'src/import-export/projectJsonLegacy.ts',
    r"openingPhases: Array\.isArray\(parsed\.openingPhases\) \? parsed\.openingPhases\.map\(phase => \(\{ id: String\(phase\.id\), lineId: String\(phase\.lineId\), name: typeof phase\.name === 'string' \? phase\.name : undefined, openedAt: normalizeRequiredDate\(phase\.openedAt, today\), segmentIds:",
    "openingPhases: Array.isArray(parsed.openingPhases) ? parsed.openingPhases.map(phase => ({ id: String(phase.id), lineId: String(phase.lineId), name: typeof phase.name === 'string' ? phase.name : undefined, openedAt: normalizeRequiredDate(phase.openedAt, today), ...(phase.eventType === 'close' ? { eventType: 'close' as const } : {}), segmentIds:",
)

# Presentation must never treat closure-group metadata as an opening phase.
replace_once(
    'src/presentation/compiler.ts',
    "const phase = project.openingPhases.find(item => item.lineId === openingLineId && item.openedAt === date && item.segmentIds.includes(segment.id) && !item.overriddenSegmentIds?.includes(segment.id))",
    "const phase = project.openingPhases.find(item => item.eventType !== 'close' && item.lineId === openingLineId && item.openedAt === date && item.segmentIds.includes(segment.id) && !item.overriddenSegmentIds?.includes(segment.id))",
)
replace_once(
    'src/presentation/compiler.ts',
    "const phase = project.openingPhases.find(item => item.lineId === relation.lineId && item.openedAt === historyDate && item.stationRelationIds.includes(relation.id) && !item.overriddenStationRelationIds?.includes(relation.id))",
    "const phase = project.openingPhases.find(item => item.eventType !== 'close' && item.lineId === relation.lineId && item.openedAt === historyDate && item.stationRelationIds.includes(relation.id) && !item.overriddenStationRelationIds?.includes(relation.id))",
)

replace_once(
    'src/components/StyleGeometryInspector.tsx',
    "import { markSegmentDateOverride, phaseForSegment } from '../data/openingPhases'",
    "import { clearSegmentDateOverride, markSegmentDateOverride, phaseForSegment } from '../data/openingPhases'",
)
replace_once(
    'src/components/StyleGeometryInspector.tsx',
    "    const phase = phaseForSegment(project,segment.id)",
    "    const openingPhase = phaseForSegment(project,segment.id,'open'), closurePhase = phaseForSegment(project,segment.id,'close')\n    const openingOverridden = Boolean(openingPhase?.overriddenSegmentIds?.includes(segment.id)), closureOverridden = Boolean(closurePhase?.overriddenSegmentIds?.includes(segment.id))",
)
replace_once(
    'src/components/StyleGeometryInspector.tsx',
    "      <Field label=\"开通日期\"><input type=\"date\" value={segment.openedAt??''} onChange={event=>patch(next=>{markSegmentDateOverride(next,segment.id);next.geometry.segments.find(item=>item.id===segment.id)!.openedAt=event.target.value||null})}/></Field>\n      <Field label=\"停运日期\"><input type=\"date\" value={segment.closedAt??''} onChange={event=>patch(next=>{next.geometry.segments.find(item=>item.id===segment.id)!.closedAt=event.target.value||null})}/></Field>\n      {phase&&<p className=\"meta-note\">开通阶段：{phase.name||'未命名阶段'}{phase.overriddenSegmentIds?.includes(segment.id)?'，已单独覆盖':''}</p>}",
    "      <section className=\"station-label-layout\"><span className=\"eyebrow\">运营时间 · {stationName(segment.fromStationId)} — {stationName(segment.toStationId)}</span><p className=\"meta-note\">时间始终作用于完整站间区间；样式点只划分样式，不划分时间。</p><Field label=\"开通方式\"><select value={openingPhase&&!openingOverridden?'phase':'custom'} onChange={event=>patch(next=>{if(event.target.value==='phase')clearSegmentDateOverride(next,segment.id,'open');else markSegmentDateOverride(next,segment.id,'open')})}><option value=\"phase\" disabled={!openingPhase}>随运营事件{openingPhase?`（${openingPhase.openedAt}）`:'（未归属事件）'}</option><option value=\"custom\">单独指定日期</option></select></Field>{(!openingPhase||openingOverridden)&&<Field label=\"开通日期\"><input type=\"date\" value={segment.openedAt??''} onChange={event=>patch(next=>{markSegmentDateOverride(next,segment.id,'open');next.geometry.segments.find(item=>item.id===segment.id)!.openedAt=event.target.value||null})}/></Field>}<Field label=\"停运方式\"><select value={closurePhase&&!closureOverridden?'phase':'custom'} onChange={event=>patch(next=>{if(event.target.value==='phase')clearSegmentDateOverride(next,segment.id,'close');else markSegmentDateOverride(next,segment.id,'close')})}><option value=\"phase\" disabled={!closurePhase}>随运营事件{closurePhase?`（${closurePhase.openedAt}）`:'（未归属事件）'}</option><option value=\"custom\">单独指定日期</option></select></Field>{(!closurePhase||closureOverridden)&&<Field label=\"停运日期\"><input type=\"date\" value={segment.closedAt??''} onChange={event=>patch(next=>{markSegmentDateOverride(next,segment.id,'close');next.geometry.segments.find(item=>item.id===segment.id)!.closedAt=event.target.value||null})}/></Field>}</section>",
)

# Station-line relations get the same inheritance/override model for both opening and closure.
old_relation = '''      <div className="relation-list"><span className="eyebrow">车站开通</span>{project.stationLineRelations.filter((r) => r.stationId === station.id).map((relation) => {const phase=phaseForRelation(project,relation.id),overridden=Boolean(phase?.overriddenStationRelationIds?.includes(relation.id)),line=project.lines.find(item=>item.id===relation.lineId),lineDisplayName=line ? (getLineDisplayName(project,line) || relation.lineId) : relation.lineId,passedDate=project.geometry.segments.filter(segment=>segment.lineId===relation.lineId&&(segment.fromStationId===station.id||segment.toStationId===station.id)).map(segment=>segment.openedAt).filter((date):date is string=>Boolean(date)).sort()[0],deferred=Boolean(relation.openedAt&&passedDate&&relation.openedAt>passedDate);return <div key={relation.id} className="station-opening-row"><strong>{lineDisplayName}</strong><Field label="本站编号"><input aria-label={`${lineDisplayName}本站编号`} value={relation.stationCode??''} onChange={event=>patch(next=>{const target=next.stationLineRelations.find(item=>item.id===relation.id)!;target.stationCode=event.target.value||undefined})}/></Field><Field label="开通方式"><select aria-label={`${lineDisplayName}车站开通方式`} value={phase&&!overridden?'phase':'custom'} onChange={event=>patch(next=>{if(event.target.value==='phase')clearRelationDateOverride(next,relation.id);else markRelationDateOverride(next,relation.id)})}><option value="phase" disabled={!phase}>随阶段开通{phase?`（${phase.openedAt}）`:'（未归属阶段）'}</option><option value="custom">单独指定日期</option></select></Field>{(!phase||overridden)&&<Field label="开通日期"><input type="date" value={relation.openedAt??''} onChange={event=>patch(next=>{markRelationDateOverride(next,relation.id);next.stationLineRelations.find(item=>item.id===relation.id)!.openedAt=event.target.value||null})}/></Field>}{deferred&&<p className="meta-note deferred-opening-note">暂缓开通：线路已于 {passedDate} 经过本站，本站于 {relation.openedAt} 开通。</p>}<Field label="停运"><input type="date" value={relation.closedAt??''} onChange={event=>patch(next=>{next.stationLineRelations.find(item=>item.id===relation.id)!.closedAt=event.target.value||null})}/></Field></div>})}</div>'''
new_relation = '''      <div className="relation-list"><span className="eyebrow">车站运营</span>{project.stationLineRelations.filter((r) => r.stationId === station.id).map((relation) => {const phase=phaseForRelation(project,relation.id,'open'),closurePhase=phaseForRelation(project,relation.id,'close'),overridden=Boolean(phase?.overriddenStationRelationIds?.includes(relation.id)),closureOverridden=Boolean(closurePhase?.overriddenStationRelationIds?.includes(relation.id)),line=project.lines.find(item=>item.id===relation.lineId),lineDisplayName=line ? (getLineDisplayName(project,line) || relation.lineId) : relation.lineId,passedDate=project.geometry.segments.filter(segment=>segment.lineId===relation.lineId&&(segment.fromStationId===station.id||segment.toStationId===station.id)).map(segment=>segment.openedAt).filter((date):date is string=>Boolean(date)).sort()[0],deferred=Boolean(relation.openedAt&&passedDate&&relation.openedAt>passedDate);return <div key={relation.id} className="station-opening-row"><strong>{lineDisplayName}</strong><Field label="本站编号"><input aria-label={`${lineDisplayName}本站编号`} value={relation.stationCode??''} onChange={event=>patch(next=>{const target=next.stationLineRelations.find(item=>item.id===relation.id)!;target.stationCode=event.target.value||undefined})}/></Field><Field label="开通方式"><select aria-label={`${lineDisplayName}车站开通方式`} value={phase&&!overridden?'phase':'custom'} onChange={event=>patch(next=>{if(event.target.value==='phase')clearRelationDateOverride(next,relation.id,'open');else markRelationDateOverride(next,relation.id,'open')})}><option value="phase" disabled={!phase}>随运营事件{phase?`（${phase.openedAt}）`:'（未归属事件）'}</option><option value="custom">单独指定日期</option></select></Field>{(!phase||overridden)&&<Field label="开通日期"><input type="date" value={relation.openedAt??''} onChange={event=>patch(next=>{markRelationDateOverride(next,relation.id,'open');next.stationLineRelations.find(item=>item.id===relation.id)!.openedAt=event.target.value||null})}/></Field>}{deferred&&<p className="meta-note deferred-opening-note">暂缓开通：线路已于 {passedDate} 经过本站，本站于 {relation.openedAt} 开通。</p>}<Field label="停运方式"><select aria-label={`${lineDisplayName}车站停运方式`} value={closurePhase&&!closureOverridden?'phase':'custom'} onChange={event=>patch(next=>{if(event.target.value==='phase')clearRelationDateOverride(next,relation.id,'close');else markRelationDateOverride(next,relation.id,'close')})}><option value="phase" disabled={!closurePhase}>随运营事件{closurePhase?`（${closurePhase.openedAt}）`:'（未归属事件）'}</option><option value="custom">单独指定日期</option></select></Field>{(!closurePhase||closureOverridden)&&<Field label="停运日期"><input type="date" value={relation.closedAt??''} onChange={event=>patch(next=>{markRelationDateOverride(next,relation.id,'close');next.stationLineRelations.find(item=>item.id===relation.id)!.closedAt=event.target.value||null})}/></Field>}</div>})}</div>'''
replace_once('src/components/InspectorLegacy.tsx', old_relation, new_relation)

# Mobile history list names both event types instead of treating every item as an opening phase.
replace_once(
    'src/components/MobileShell.tsx',
    "import type { OpeningPhasePath } from '../data/openingPhases'",
    "import { getOperationEventType, type OpeningPhasePath } from '../data/openingPhases'",
)
replace_once(
    'src/components/MobileShell.tsx',
    "{active === 'history' && <section className=\"mobile-drawer-section mobile-history\"><button className=\"primary\" onClick={() => { onOpenPresentation(); close() }}>打开发展史演示</button><div className=\"mobile-history-list\">{[...project.openingPhases].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id)).map(phase => { return <button key={phase.id} onClick={() => { onSelectLine(phase.lineId); setActive('inspector') }}><time>{phase.openedAt}</time><strong>{phase.name || '未命名阶段'}</strong><span>{getLineDisplayName(project, phase.lineId) || '未知线路'}</span></button> })}</div>{!project.openingPhases.length && <p>尚未建立开通阶段；可在线路属性中添加。</p>}</section>}",
    "{active === 'history' && <section className=\"mobile-drawer-section mobile-history\"><button className=\"primary\" onClick={() => { onOpenPresentation(); close() }}>打开发展史演示</button><div className=\"mobile-history-list\">{[...project.openingPhases].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id)).map(phase => { const eventLabel=getOperationEventType(phase)==='close'?'停运':'开通'; return <button key={phase.id} onClick={() => { onSelectLine(phase.lineId); setActive('inspector') }}><time>{phase.openedAt}</time><strong>{eventLabel} · {phase.name || '未命名事件'}</strong><span>{getLineDisplayName(project, phase.lineId) || '未知线路'}</span></button> })}</div>{!project.openingPhases.length && <p>尚未建立运营事件；可在线路属性中添加。</p>}</section>}",
)

# Opening history compiler remains backward compatible while closure dates continue to compile from object.closedAt.

# Extend regression coverage for closure groups and independent overrides.
test_path = 'src/data/openingPhases.test.ts'
test_text = read(test_path)
test_text = test_text.replace(
    "import { clearRelationDateOverride, createOpeningPhase, getOpeningPhasePathCandidates, markRelationDateOverride, markSegmentDateOverride, updateOpeningPhase } from './openingPhases'",
    "import { clearRelationDateOverride, clearSegmentDateOverride, createOpeningPhase, getOpeningPhasePathCandidates, markRelationDateOverride, markSegmentDateOverride, phaseForSegment, updateOpeningPhase } from './openingPhases'",
)
insert = r'''

  it('creates a closure event across complete station-to-station segments without closing a still-served boundary station', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const created = createOpeningPhase(base, { lineId: 'line-a', name: '东段停运', openedAt: '2030-01-01', eventType: 'close', path })
    const phase = created.project.openingPhases.find(item => item.id === created.phaseId)!
    expect(phase.eventType).toBe('close')
    expect(created.project.geometry.segments.find(item => item.id === 'a-2')?.closedAt).toBe('2030-01-01')
    expect(created.project.geometry.segments.find(item => item.id === 'a-3')?.closedAt).toBe('2030-01-01')
    expect(created.project.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')?.closedAt).toBeFalsy()
    expect(created.project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')?.closedAt).toBe('2030-01-01')
    expect(created.project.stationLineRelations.find(item => item.stationId === 's4' && item.lineId === 'line-a')?.closedAt).toBe('2030-01-01')
    expect(phaseForSegment(created.project, 'a-2', 'close')?.id).toBe(created.phaseId)
  })

  it('keeps closure overrides independent from opening overrides and can restore inherited closure dates', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const created = createOpeningPhase(base, { lineId: 'line-a', openedAt: '2030-01-01', eventType: 'close', path })
    markSegmentDateOverride(created.project, 'a-3', 'close')
    created.project.geometry.segments.find(item => item.id === 'a-3')!.closedAt = '2031-06-01'
    const updated = updateOpeningPhase(created.project, created.phaseId, { openedAt: '2030-12-31' })
    expect(updated.geometry.segments.find(item => item.id === 'a-2')?.closedAt).toBe('2030-12-31')
    expect(updated.geometry.segments.find(item => item.id === 'a-3')?.closedAt).toBe('2031-06-01')
    expect(updated.geometry.segments.find(item => item.id === 'a-3')?.openedAt).not.toBe('2031-06-01')
    clearSegmentDateOverride(updated, 'a-3', 'close')
    expect(updated.geometry.segments.find(item => item.id === 'a-3')?.closedAt).toBe('2030-12-31')
  })
'''
if not test_text.endswith('})\n'):
    raise RuntimeError('openingPhases.test.ts: unexpected ending')
test_text = test_text[:-3] + insert + '})\n'
write(test_path, test_text)

replace_once('src/build.ts', "export const BUILD_VERSION = '2026-09-14-basemap-drawing-80'", "export const BUILD_VERSION = '2026-09-14-operation-history-81'")

print('Build81 operation-history patches applied successfully.')
