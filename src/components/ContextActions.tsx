import type { ActualRouteProject, Selection, StructureType } from '../data/model'
import { getWaypointStructureAfter } from '../data/structure'

export function ContextActions({ project, selection, onExtend, onInsertStation, onAddWaypoint, onStraighten, onStructureChange, onSetStructureAtPoint, onWaypointStructureChange, onStructureNodeChange, onDelete }: {
  project: ActualRouteProject; selection: Selection; onExtend: (stationId: string) => void; onInsertStation: () => void; onAddWaypoint: () => void; onStraighten: () => void
  onStructureChange: (value: StructureType) => void; onSetStructureAtPoint?: (value: StructureType) => void; onWaypointStructureChange?: (value: StructureType | null) => void; onStructureNodeChange?: (value: StructureType) => void; onDelete: () => void
}) {
  if (!selection) return null
  const title = selection.type === 'station' ? project.stations.find(item => item.id === selection.id)?.name ?? '站点' : selection.type === 'segment' ? '区间' : selection.type === 'waypoint' ? '路径点' : selection.type === 'structureNode' ? '结构节点' : selection.type === 'line' ? project.lines.find(item => item.id === selection.id)?.name ?? '线路' : '底图'
  const segment = selection.type === 'segment' ? project.geometry.segments.find(item => item.id === selection.id) : null
  const waypointSegment = selection.type === 'waypoint' ? project.geometry.segments.find(item => item.id === selection.segmentId) : null
  const waypointStructure = selection.type === 'waypoint' && waypointSegment ? getWaypointStructureAfter(waypointSegment, selection.id) : null
  const structureNode = selection.type === 'structureNode' ? project.geometry.segments.find(item => item.id === selection.segmentId)?.structureNodes?.find(item => item.id === selection.id) : null
  if(segment)return <section className="context-sheet context-action-bar" aria-label="区间快捷操作"><strong>{title}</strong><button className="primary" onClick={onInsertStation}>＋站点</button><button onClick={onAddWaypoint}>＋路径点</button><details className="context-menu"><summary>结构⌄</summary><div><label><span>区间起始结构</span><select aria-label="线路结构" value={segment.structureType} onChange={event=>onStructureChange(event.target.value as StructureType)}><StructureOptions/></select></label>{onSetStructureAtPoint&&<><button onClick={()=>onSetStructureAtPoint('ground')}>从点击处开始地面</button><button onClick={()=>onSetStructureAtPoint('underground')}>从点击处开始地下</button><button onClick={()=>onSetStructureAtPoint('elevated')}>从点击处开始高架</button></>}</div></details><details className="context-menu"><summary aria-label="更多区间操作">···</summary><div><button onClick={onStraighten}>恢复直线</button><button className="danger" onClick={onDelete}>删除区间</button></div></details></section>
  return <section className="context-sheet" aria-label="对象操作"><div className="sheet-handle"/><strong>{title}</strong><div className="context-buttons">
    {selection.type==='station'&&<button className="primary" onClick={()=>onExtend(selection.id)}>＋ 从本站延伸</button>}
    {selection.type==='waypoint'&&onWaypointStructureChange&&<label className="structure-control"><span>从此控制点开始</span><select aria-label="控制点结构变化" value={waypointStructure??''} onChange={event=>onWaypointStructureChange((event.target.value||null) as StructureType|null)}><option value="">不改变</option><StructureOptions/></select></label>}
    {structureNode&&onStructureNodeChange&&<label className="structure-control"><span>从此处开始</span><select aria-label="结构节点类型" value={structureNode.structureAfter} onChange={event=>onStructureNodeChange(event.target.value as StructureType)}><StructureOptions/></select></label>}
    <button className="danger" onClick={onDelete}>删除</button>
  </div></section>
}
function StructureOptions(){return <><option value="underground">地下</option><option value="elevated">高架</option><option value="ground">地面（预留）</option></>}
