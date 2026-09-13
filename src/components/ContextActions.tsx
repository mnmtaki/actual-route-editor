import type { ActualRouteProject, Selection, StructureType } from '../data/model'
import type { WaypointStructureChange } from '../data/structure'
import { DropdownArrow } from './Toolbar'
import { getLineDisplayName } from '../data/lineIdentity'

export function ContextActions({ project, selection, onExtend, onInsertStation, onAddWaypoint, onStraighten: _onStraighten, onStructureChange: _onStructureChange, onSetStructureAtPoint, onWaypointStructureChange: _onWaypointStructureChange, onStructureNodeChange: _onStructureNodeChange, onDelete }: {
  project: ActualRouteProject; selection: Selection; onExtend: (stationId: string) => void; onInsertStation: () => void; onAddWaypoint: () => void; onStraighten: () => void
  onStructureChange: (value: StructureType) => void; onSetStructureAtPoint?: (value: StructureType) => void; onWaypointStructureChange?: (value: WaypointStructureChange) => void; onStructureNodeChange?: (value: StructureType) => void; onDelete: () => void
}) {
  if (!selection) return null
  const title = selection.type === 'station' ? project.stations.find(item => item.id === selection.id)?.name ?? '站点' : selection.type === 'segment' ? '线路段' : selection.type === 'waypoint' ? '控制点' : selection.type === 'structureNode' ? '样式点' : selection.type === 'line' ? getLineDisplayName(project, selection.id) || '线路' : '底图'
  const segment = selection.type === 'segment' ? project.geometry.segments.find(item => item.id === selection.id) : null
  if (segment) return <section className="context-sheet context-action-bar" aria-label="线路段快捷操作"><strong>{title}</strong><button className="primary" onClick={onInsertStation}>＋站点</button><button onClick={onAddWaypoint}>＋控制点</button>{onSetStructureAtPoint&&<button onClick={()=>onSetStructureAtPoint(segment.structureType)}>＋样式点</button>}<details className="context-menu"><summary aria-label="更多线路段操作">更多<DropdownArrow/></summary><div><button className="danger" onClick={onDelete}>删除站间区间</button></div></details></section>
  return <section className="context-sheet" aria-label="对象操作"><div className="sheet-handle"/><strong>{title}</strong><div className="context-buttons">
    {selection.type==='station'&&<button className="primary" onClick={()=>onExtend(selection.id)}>＋ 从本站延伸</button>}
    {selection.type==='waypoint'&&<span className="context-hint">拖动控制点改变线路形状</span>}
    {selection.type==='structureNode'&&<span className="context-hint">拖动样式点移动样式分界</span>}
    <button className="danger" onClick={onDelete}>删除</button>
  </div></section>
}
