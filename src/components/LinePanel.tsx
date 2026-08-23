import type { ActualRouteProject, Selection } from '../data/model'

export function LinePanel({ project, selection, activeLineId, onSelect, onChange, onAddLine }: {
  project: ActualRouteProject; selection: Selection; activeLineId: string | null
  onSelect: (id: string) => void; onChange: (project: ActualRouteProject) => void; onAddLine: () => void
}) {
  const patchSettings = (mutate: (next: ActualRouteProject) => void) => { const next = structuredClone(project); mutate(next); onChange(next) }
  return <aside className="left-panel panel">
    <div className="panel-heading"><div><span className="eyebrow">NETWORK</span><h2>线路</h2></div><button className="icon-button" onClick={onAddLine} aria-label="新增线路">＋</button></div>
    <div className="line-list">{project.lines.map(line => <button key={line.id} className={`line-row ${activeLineId === line.id || (selection?.type === 'line' && selection.id === line.id) ? 'selected' : ''}`} onClick={() => onSelect(line.id)}><span className="line-color" style={{ background: line.color }} /><span className="line-name">{line.name}</span><span className="station-count">{line.stationSequence.length}</span><input aria-label={`${line.name}显示`} type="checkbox" checked={line.visible} onClick={event => event.stopPropagation()} onChange={event => patchSettings(next => { next.lines.find(item => item.id === line.id)!.visible = event.target.checked })} /></button>)}</div>
    <div className="panel-section compact">
      <span className="eyebrow">DISPLAY / STYLE</span>
      <label className="style-range"><span>站点大小</span><div><input aria-label="站点大小" type="range" min="3" max="24" step="0.5" value={project.settings.stationSize} onChange={event => patchSettings(next => { next.settings.stationSize = Number(event.target.value) })} /><output>{project.settings.stationSize}</output></div></label>
      <label className="toggle-row">显示网格<input type="checkbox" checked={project.settings.gridVisible} onChange={event => patchSettings(next => { next.settings.gridVisible = event.target.checked })} /></label>
      <label className="toggle-row">显示全部站名<input type="checkbox" checked={project.settings.labelsVisible} onChange={event => patchSettings(next => { next.settings.labelsVisible = event.target.checked })} /></label>
      {project.background && <><label className="toggle-row">显示底图<input type="checkbox" checked={project.background.visible} onChange={event => patchSettings(next => { next.background!.visible = event.target.checked })} /></label><label className="toggle-row">锁定底图<input type="checkbox" checked={project.background.locked} onChange={event => patchSettings(next => { next.background!.locked = event.target.checked })} /></label></>}
    </div>
    <div className="hint-card"><strong>绘制提示</strong><p>直接拖动站点；拖空白平移。选中站点点“＋”延伸或拉支线；选中区间可插站或添加路径点。</p></div>
  </aside>
}
