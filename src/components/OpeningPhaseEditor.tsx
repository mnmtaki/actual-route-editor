import { useEffect, useMemo, useState } from 'react'
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
