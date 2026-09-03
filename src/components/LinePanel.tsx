import type { ActualRouteProject, Selection } from '../data/model'
import { getSegmentCurveLength } from '../geometry/path'

function EyeIcon({ hidden = false }: { hidden?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="line-state-icon"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />{!hidden && <circle cx="12" cy="12" r="2.5" fill="currentColor" />}{hidden && <path d="m4 4 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
}

function LockIcon({ locked = false }: { locked?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="line-state-icon"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />{locked ? <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M9 10V7a3 3 0 0 1 5.5-1.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
}

export function LinePanel({project,selection,activeLineId,onSelect,onChange,onAddLine}:{project:ActualRouteProject;selection:Selection;activeLineId:string|null;onSelect:(id:string)=>void;onChange:(project:ActualRouteProject)=>void;onAddLine:()=>void}){
  const patch=(mutate:(next:ActualRouteProject)=>void)=>{const next=structuredClone(project);mutate(next);onChange(next)}
  const scale=project.settings.worldUnitsPerKm>0?project.settings.worldUnitsPerKm:100
  const lineStats=project.lines.map(line=>({line,length:project.geometry.segments.filter(segment=>segment.lineId===line.id).reduce((sum,segment)=>sum+getSegmentCurveLength(project,segment),0)/scale,stations:new Set(line.stationSequence).size}))
  const totalLength=lineStats.reduce((sum,item)=>sum+item.length,0)
  const totalStations=new Set(project.stationLineRelations.map(relation=>relation.stationId)).size
  return <aside className="left-panel panel" aria-label="线路结构">
    <div className="panel-heading"><div><h2>线路</h2><span className="panel-subtitle">线路与图层</span></div><button className="icon-button" onClick={onAddLine} aria-label="新增线路">＋</button></div>
    <div className="line-list">{project.lines.map(line=><div key={line.id} className={`line-row ${activeLineId===line.id||(selection?.type==='line'&&selection.id===line.id)?'selected':''}`}>
      <button type="button" className="line-row-main" onClick={()=>onSelect(line.id)}><span aria-hidden="true" className="line-color" style={{background:line.color}}/><span className="line-name">{line.name}</span></button>
      <button type="button" className={`line-state-button ${line.visible?'is-on':''}`} aria-label={line.visible?`${line.name}隐藏线路`:`${line.name}显示线路`} title={line.visible?'隐藏线路':'显示线路'} onClick={()=>patch(next=>{const target=next.lines.find(item=>item.id===line.id);if(target)target.visible=!target.visible})}><span aria-hidden="true"><EyeIcon hidden={!line.visible} /></span></button>
      <button type="button" className={`line-state-button ${line.locked?'is-on':''}`} aria-label={line.locked?`${line.name}解锁线路`:`${line.name}锁定线路`} title={line.locked?'解锁线路':'锁定线路'} onClick={()=>patch(next=>{const target=next.lines.find(item=>item.id===line.id);if(target)target.locked=!target.locked})}><span aria-hidden="true"><LockIcon locked={line.locked} /></span></button>
    </div>)}</div>
    <details className="network-overview"><summary>线网概览</summary><div className="network-summary" aria-label="线网统计"><div className="network-total"><strong>全网</strong><span>{totalLength.toFixed(1)} km</span><span>{totalStations} 座车站</span></div><details className="network-line-details"><summary>查看线路详情</summary><div className="network-line-stats">{lineStats.map(({line,length,stations})=><div key={line.id}><i style={{background:line.color}}/><strong>{line.name}</strong><span>{length.toFixed(1)} km</span><span>{stations} 站</span></div>)}</div></details></div></details>
    <details className="panel-help"><summary>操作提示</summary><p>直接拖动车站；拖动空白平移。选中车站可延伸线路，选中区间可插入车站或路径点。</p></details>
  </aside>
}
