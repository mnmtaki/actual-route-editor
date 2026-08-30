import { useEffect, useMemo, useState } from 'react'
import type { ActualRouteProject, Line, OpeningPhase } from '../data/model'
import { createOpeningPhase, deleteOpeningPhase, getOpeningPhasePathCandidates, updateOpeningPhase, type OpeningPhasePath } from '../data/openingPhases'

export function OpeningPhaseEditor({ project, line, onChange, onPreview, onStartDrawing }: {
  project: ActualRouteProject
  line: Line
  onChange: (next: ActualRouteProject) => void
  onPreview: (path: OpeningPhasePath | null) => void
  onStartDrawing: (phaseId: string, lineId: string, stationId: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [openedAt, setOpenedAt] = useState(project.timeline.currentDate)
  const [startId, setStartId] = useState(line.stationSequence[0] ?? '')
  const [endId, setEndId] = useState(line.stationSequence.at(-1) ?? '')
  const [candidateIndex, setCandidateIndex] = useState(0)
  const phases = project.openingPhases.filter(phase => phase.lineId === line.id).sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id))
  const candidates = useMemo(() => getOpeningPhasePathCandidates(project, line.id, startId, endId), [project, line.id, startId, endId])
  const candidate = candidates[candidateIndex] ?? candidates[0] ?? null
  useEffect(() => { onPreview(adding ? candidate : null); return () => onPreview(null) }, [adding, candidate, onPreview])
  useEffect(() => { if (candidateIndex >= candidates.length) setCandidateIndex(0) }, [candidateIndex, candidates.length])

  const confirmExisting = () => {
    if (!openedAt || !candidate) return
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt, path: candidate, revealStartStationId: startId, revealEndStationId: endId })
    onChange(result.project); reset()
  }
  const startNewConstruction = () => {
    if (!openedAt) return
    const result = createOpeningPhase(project, { lineId: line.id, name, openedAt, revealStartStationId: startId || undefined })
    onChange(result.project); onStartDrawing(result.phaseId, line.id, startId || null); reset()
  }
  const reset = () => { setAdding(false); setName(''); setCandidateIndex(0); onPreview(null) }

  return <section className="opening-phases">
    <div className="opening-phases-title"><strong>开通历史</strong></div>
    {phases.length === 0 && <p className="meta-note">尚未建立开通阶段；旧日期仍会按拓扑自动推导演示。</p>}
    {phases.map(phase => <PhaseRow key={phase.id} phase={phase} project={project} onChange={onChange} onStartDrawing={onStartDrawing} />)}
    {!adding ? <button onClick={() => setAdding(true)}>＋ 添加开通阶段</button> : <div className="opening-phase-form">
      <label className="field"><span>阶段名称（可选）</span><input value={name} onChange={event => setName(event.target.value)} placeholder="一期 / 东延 / 北延" /></label>
      <label className="field"><span>开通日期</span><input type="date" value={openedAt} onChange={event => setOpenedAt(event.target.value)} /></label>
      <div className="field-grid"><label className="field"><span>起点</span><select value={startId} onChange={event => { setStartId(event.target.value); setCandidateIndex(0) }}><StationOptions project={project} line={line} /></select></label><label className="field"><span>终点</span><select value={endId} onChange={event => { setEndId(event.target.value); setCandidateIndex(0) }}><StationOptions project={project} line={line} /></select></label></div>
      {candidates.length > 1 && <label className="field phase-warning"><span>存在 {candidates.length} 条候选路径，请选择</span><select value={candidateIndex} onChange={event => setCandidateIndex(Number(event.target.value))}>{candidates.map((path, index) => <option key={path.segmentIds.join('|')} value={index}>候选 {index + 1} · {path.stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' → ')}</option>)}</select></label>}
      {startId && endId && startId !== endId && candidates.length === 0 && <p className="phase-error">当前线路拓扑中找不到连续路径。</p>}
      {candidate && <p className="phase-preview-copy">将设置 {candidate.segmentIds.length} 个区间、沿途 {candidate.stationIds.length} 个站；地图已高亮预览。</p>}
      <button className="primary" disabled={!candidate || !openedAt} onClick={confirmExisting}>确认并批量设置整段日期</button>
      <button disabled={!startId || !openedAt} onClick={startNewConstruction}>从起点开始绘制此阶段</button>
      <button onClick={reset}>取消</button>
    </div>}
  </section>
}

function PhaseRow({ phase, project, onChange, onStartDrawing }: { phase: OpeningPhase; project: ActualRouteProject; onChange: (next: ActualRouteProject) => void; onStartDrawing: (phaseId: string, lineId: string, stationId: string | null) => void }) {
  const stationIds = phaseStations(project, phase)
  const label = stationIds.map(id => project.stations.find(station => station.id === id)?.name ?? id).join(' — ') || '等待绘制成员'
  const overrideCount = (phase.overriddenSegmentIds?.length ?? 0) + (phase.overriddenStationRelationIds?.length ?? 0)
  const endpoint = stationIds.at(-1) ?? null
  return <div className="opening-phase-row">
    <div><strong>{phase.name || '未命名阶段'}</strong><span>{label}</span>{overrideCount > 0 && <em>{overrideCount} 项已单独覆盖</em>}</div>
    <input aria-label={`${phase.name || '阶段'}开通日期`} type="date" value={phase.openedAt} onChange={event => onChange(updateOpeningPhase(project, phase.id, { openedAt: event.target.value }))} />
    <button onClick={() => onStartDrawing(phase.id, phase.lineId, endpoint)}>继续绘制</button>
    <button className="danger" onClick={() => onChange(deleteOpeningPhase(project, phase.id))}>删除分组</button>
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
