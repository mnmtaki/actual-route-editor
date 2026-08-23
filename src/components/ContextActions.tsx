import type { ActualRouteProject, Selection } from '../data/model'

export function ContextActions({ project, selection, onExtend, onInsertStation, onAddWaypoint, onStraighten, onDelete }: {
  project:ActualRouteProject; selection:Selection; onExtend:(stationId:string)=>void; onInsertStation:()=>void; onAddWaypoint:()=>void; onStraighten:()=>void; onDelete:()=>void
}) {
  if (!selection) return null
  const title = selection.type === 'station' ? project.stations.find(s=>s.id===selection.id)?.name ?? '站点' : selection.type === 'segment' ? '区间' : selection.type === 'waypoint' ? '路径点' : selection.type === 'line' ? project.lines.find(l=>l.id===selection.id)?.name ?? '线路' : '底图'
  return <section className="context-sheet" aria-label="对象操作"><div className="sheet-handle"/><strong>{title}</strong><div className="context-buttons">
    {selection.type === 'station' && <button className="primary" onClick={()=>onExtend(selection.id)}>＋ 从本站延伸</button>}
    {selection.type === 'segment' && <><button className="primary" onClick={onInsertStation}>＋ 插入站点</button><button onClick={onAddWaypoint}>＋ 路径点</button><button onClick={onStraighten}>恢复直线</button></>}
    <button className="danger" onClick={onDelete}>删除</button>
  </div></section>
}

