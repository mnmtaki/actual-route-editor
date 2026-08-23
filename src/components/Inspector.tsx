import type { ActualRouteProject, Selection, SegmentMode } from '../data/model'
import { uid } from '../data/model'

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>

export function Inspector({ project, selection, onChange, onDelete }: { project: ActualRouteProject; selection: Selection; onChange: (next: ActualRouteProject) => void; onDelete: () => void }) {
  const patch = (mutate: (next: ActualRouteProject) => void) => { const next = structuredClone(project); mutate(next); onChange(next) }
  let content: React.ReactNode = <div className="empty-inspector"><span>◎</span><p>选择站点、区间、控制点或线路，查看和修改属性。</p></div>

  if (selection?.type === 'station') {
    const station = project.stations.find((item) => item.id === selection.id)
    if (station) content = <>
      <h3>站点</h3>
      <Field label="名称"><input value={station.name} onChange={(e) => patch((n) => { n.stations.find((s) => s.id === station.id)!.name = e.target.value })} /></Field>
      <div className="field-grid"><Field label="X"><input type="number" value={Math.round(station.x)} onChange={(e) => patch((n) => { n.stations.find((s) => s.id === station.id)!.x = Number(e.target.value) })} /></Field><Field label="Y"><input type="number" value={Math.round(station.y)} onChange={(e) => patch((n) => { n.stations.find((s) => s.id === station.id)!.y = Number(e.target.value) })} /></Field></div>
      <Field label="站点开通"><input type="date" value={station.openedAt ?? ''} onChange={(e) => patch((n) => { n.stations.find((s) => s.id === station.id)!.openedAt = e.target.value || null })} /></Field>
      <Field label="方向锚定线路"><select value={station.orientationAnchorLineId ?? ''} onChange={(e) => patch((n) => { n.stations.find((s) => s.id === station.id)!.orientationAnchorLineId = e.target.value || undefined })}><option value="">自动：最早线路</option>{project.lines.filter((l) => project.stationLineRelations.some((r) => r.stationId === station.id && r.lineId === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <div className="relation-list"><span className="eyebrow">STATION–LINE TIME</span>{project.stationLineRelations.filter((r) => r.stationId === station.id).map((relation) => <Field key={relation.id} label={project.lines.find((l) => l.id === relation.lineId)?.name ?? relation.lineId}><input type="date" value={relation.openedAt ?? ''} onChange={(e) => patch((n) => { n.stationLineRelations.find((r) => r.id === relation.id)!.openedAt = e.target.value || null })} /></Field>)}</div>
      <label className="toggle-row">隐藏本站标签<input type="checkbox" checked={!!station.labelHidden} onChange={(e) => patch((n) => { n.stations.find((s) => s.id === station.id)!.labelHidden = e.target.checked })} /></label>
      <button className="danger" onClick={onDelete}>删除站点</button>
    </>
  } else if (selection?.type === 'line') {
    const line = project.lines.find((item) => item.id === selection.id)
    if (line) content = <>
      <h3>线路</h3>
      <Field label="名称"><input value={line.name} onChange={(e) => patch((n) => { n.lines.find((l) => l.id === line.id)!.name = e.target.value })} /></Field>
      <Field label="线路颜色"><input type="color" value={line.color} onChange={(e) => patch((n) => { n.lines.find((l) => l.id === line.id)!.color = e.target.value })} /></Field>
      <Field label="开通日期"><input type="date" value={line.openedAt ?? ''} onChange={(e) => patch((n) => { n.lines.find((l) => l.id === line.id)!.openedAt = e.target.value || null })} /></Field>
      <Field label="停运日期"><input type="date" value={line.closedAt ?? ''} onChange={(e) => patch((n) => { n.lines.find((l) => l.id === line.id)!.closedAt = e.target.value || null })} /></Field>
      <label className="toggle-row">锁定线路<input type="checkbox" checked={line.locked} onChange={(e) => patch((n) => { n.lines.find((l) => l.id === line.id)!.locked = e.target.checked })} /></label>
      {line.stationSequence.length >= 3 && <button onClick={() => patch((n) => { const current = n.lines.find((l) => l.id === line.id)!; const from = current.stationSequence.at(-1)!; const to = current.stationSequence[0]; const exists = n.geometry.segments.some((s) => s.lineId === line.id && ((s.fromStationId === from && s.toStationId === to) || (s.fromStationId === to && s.toStationId === from))); if (!exists) n.geometry.segments.push({ id: uid('segment_loop'), lineId: line.id, fromStationId: from, toStationId: to, mode: 'straight', waypoints: [], openedAt: line.openedAt }) })}>连接首尾形成环线</button>}
      <button className="danger" onClick={onDelete}>删除线路</button>
    </>
  } else if (selection?.type === 'segment') {
    const segment = project.geometry.segments.find((item) => item.id === selection.id)
    if (segment) content = <>
      <h3>区间</h3>
      <Field label="绘制模式"><select value={segment.mode} onChange={(e) => patch((n) => { n.geometry.segments.find((s) => s.id === segment.id)!.mode = e.target.value as SegmentMode })}><option value="straight">直线</option><option value="smooth">平滑</option><option value="corner">折角</option></select></Field>
      <Field label="开通日期"><input type="date" value={segment.openedAt ?? ''} onChange={(e) => patch((n) => { n.geometry.segments.find((s) => s.id === segment.id)!.openedAt = e.target.value || null })} /></Field>
      <p className="meta-note">{segment.waypoints.length} 个控制点 · 双击区间继续添加</p>
      <button onClick={() => patch((n) => { const s = n.geometry.segments.find((x) => x.id === segment.id)!; s.waypoints = []; s.mode = 'straight' })}>清空控制点并恢复直线</button>
      <button className="danger" onClick={onDelete}>删除区间</button>
    </>
  } else if (selection?.type === 'waypoint') {
    const waypoint = project.geometry.segments.find((s) => s.id === selection.segmentId)?.waypoints.find((w) => w.id === selection.id)
    if (waypoint) content = <><h3>控制点</h3><Field label="点类型"><select value={waypoint.type} onChange={(e) => patch((n) => { n.geometry.segments.find((s) => s.id === selection.segmentId)!.waypoints.find((w) => w.id === waypoint.id)!.type = e.target.value as 'smooth' | 'corner' })}><option value="smooth">SMOOTH 平滑</option><option value="corner">CORNER 折角</option></select></Field><p className="meta-note">控制点只影响几何，不参与站序或寻路。</p><button className="danger" onClick={onDelete}>删除控制点</button></>
  } else if (selection?.type === 'background' && project.background) {
    const bg = project.background
    content = <><h3>底图</h3><Field label="透明度"><input type="range" min="0" max="1" step="0.05" value={bg.opacity} onChange={(e) => patch((n) => { n.background!.opacity = Number(e.target.value) })} /></Field><div className="field-grid"><Field label="X"><input type="number" value={bg.x} onChange={(e) => patch((n) => { n.background!.x = Number(e.target.value) })} /></Field><Field label="Y"><input type="number" value={bg.y} onChange={(e) => patch((n) => { n.background!.y = Number(e.target.value) })} /></Field><Field label="宽度"><input type="number" value={bg.width} onChange={(e) => patch((n) => { n.background!.width = Number(e.target.value) })} /></Field><Field label="高度"><input type="number" value={bg.height} onChange={(e) => patch((n) => { n.background!.height = Number(e.target.value) })} /></Field></div><button className="danger" onClick={onDelete}>移除底图</button></>
  }
  return <aside className="right-panel panel"><div className="panel-heading"><div><span className="eyebrow">PROPERTIES</span><h2>属性</h2></div></div><div className="inspector-body">{content}</div></aside>
}
