import { useEffect, useMemo, useState } from 'react'
import type { ActualRouteProject, Line, OpeningPhase } from '../data/model'
import { createOpeningPhase, deleteOpeningPhase, getOpeningPhasePathCandidates, updateOpeningPhase, type OpeningPhasePath } from '../data/openingPhases'
import { createClosureEvent, getClosureSegmentIds, isClosureOperationEvent, updateClosureEvent } from '../data/operationEvents'

type OperationEventType = 'open' | 'close'

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
  const phases = project.openingPhases.filter(phase => phase.lineId === line.id).sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id))
  const candidates = useMemo(() => getOpeningPhasePathCandidates(project, line.id, startId, endId), [project, line.id, startId, endId])
  const candidate = candidates[candidateIndex] ?? candidates[0] ?? null
  useEffect(() => { onPreview(adding ? candidate : null); return () => onPreview(null) }, [adding, candidate, onPreview])
  useEffect(() => { if (candidateIndex >= candidates.length) setCandidateIndex(0) }, [candidateIndex, candidates.length])

  const confirmExisting = () => {
    if (!eventDate || !candidate) return
    if (eventType === 'close') {
      const result = createClosureEvent(project, { lineId: line.id, name, closedAt: eventDate, path: candidate, revealStartStationId: startId, revealEndStationId: endId })
      onChange(result.project); reset(); return
    }
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt: eventDate, path: candidate, revealStartStationId: startId, revealEndStationId: endId })
    onChange(result.project); reset()
  }
  const startNewConstruction = () => {
    if (!eventDate || eventType !== 'open') return
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt: eventDate, revealStartStationId: startId || undefined })
    onChange(result.project); onStartDrawing(result.phaseId, line.id, startId || null); reset()
  }
  const reset = () => { setAdding(false); setName(''); setEventType('open'); setCandidateIndex(0); onPreview(null) }

  return <section className="opening-phases">
    <div className="opening-phases-title"><strong>运营历史</strong></div>
    {phases.length === 0 && <p className="meta-note">尚未建立运营事件；旧日期仍会按现有对象数据正常生效。</p>}
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
  const closure = isClosureOperationEvent(phase)
  const stationIds = phaseStations(project, closure ? getClosureSegmentIds(phase) : phase.segmentIds)
  const label = stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' — ') || '等待绘制成员'
  const overrideCount = closure ? 0 : (phase.overriddenSegmentIds?.length ?? 0) + (phase.overriddenStationRelationIds?.length ?? 0)
  const endpoint = stationIds.at(-1) ?? null
  const eventLabel = closure ? '停运' : '开通'
  return <div className="opening-phase-row">
    <div><strong>{eventLabel} · {phase.name || '未命名事件'}</strong><span>{label}</span>{overrideCount > 0 && <em>{overrideCount} 项已单独覆盖</em>}</div>
    <input aria-label={`${phase.name || '事件'}${eventLabel}日期`} type="date" value={phase.openedAt} onChange={event => onChange(closure ? updateClosureEvent(project, phase.id, event.target.value) : updateOpeningPhase(project, phase.id, { openedAt: event.target.value }))} />
    {!closure && <button onClick={() => onStartDrawing(phase.id, phase.lineId, endpoint)}>继续绘制</button>}
    <button className="danger" onClick={() => onChange(deleteOpeningPhase(project, phase.id))}>删除事件</button>
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
