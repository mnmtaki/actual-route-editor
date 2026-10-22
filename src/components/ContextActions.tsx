import type { ActualRouteProject, Selection, StructureType } from '../data/model'
import { getSegmentStyleIntervalAtProgress, type WaypointStructureChange } from '../data/structure'
import { DropdownArrow } from './Toolbar'
import { getLineDisplayName } from '../data/lineIdentity'

export function ContextActions({ project, selection, onExtend, onInsertStation, onAddWaypoint, onAddLineBadge, onStraighten: _onStraighten, onStructureChange: _onStructureChange, onSetStructureAtPoint, onWaypointStructureChange: _onWaypointStructureChange, onStructureNodeChange: _onStructureNodeChange, onConvertSelectedPoint, onDelete }: {
  project: ActualRouteProject; selection: Selection; onExtend: (stationId: string) => void; onInsertStation: () => void; onAddWaypoint: () => void; onAddLineBadge?: (lineId: string, segmentId: string, progress: number) => void; onStraighten: () => void
  onStructureChange: (value: StructureType) => void; onSetStructureAtPoint?: (value: StructureType) => void; onWaypointStructureChange?: (value: WaypointStructureChange) => void; onStructureNodeChange?: (value: StructureType) => void; onConvertSelectedPoint?: () => void; onDelete: () => void
}) {
  if (!selection) return null
  const title = selection.type === 'station' ? project.stations.find(item => item.id === selection.id)?.name ?? '站点' : selection.type === 'segment' ? '线路段' : selection.type === 'waypoint' ? '控制点' : selection.type === 'structureNode' ? '样式点' : selection.type === 'line' ? getLineDisplayName(project, selection.id) || '线路' : selection.type === 'lineLabel' ? '线路标签' : '底图'
  const segment = selection.type === 'segment' ? project.geometry.segments.find(item => item.id === selection.id) : null
  if (segment) {
    const progress = selection.type === 'segment' ? selection.progress ?? .5 : .5
    const interval = getSegmentStyleIntervalAtProgress(project, segment, progress)
    return <section className="context-sheet context-action-bar" aria-label="线路段快捷操作"><strong>{title}</strong><button className="primary" onClick={onInsertStation}>＋站点</button><button onClick={onAddWaypoint}>＋控制点</button>{onAddLineBadge&&<button type="button" onClick={()=>onAddLineBadge(segment.lineId, segment.id, progress)}>＋线路标签</button>}{onSetStructureAtPoint&&<button onClick={()=>onSetStructureAtPoint(interval.structureType)}>＋样式点</button>}<details className="context-menu"><summary aria-label="更多线路段操作">更多<DropdownArrow/></summary><div><button className="danger" onClick={onDelete}>删除站间区间</button></div></details></section>
  }
  const pointSelection = selection.type === 'waypoint' || selection.type === 'structureNode'
  return <section className="context-sheet" aria-label="对象操作"><div className="sheet-handle"/><strong>{title}</strong><div className="context-buttons">
    {selection.type==='station'&&<button className="primary" onClick={()=>onExtend(selection.id)}>＋ 从本站延伸</button>}
    {(selection.type==='station'||selection.type==='waypoint') && onConvertSelectedPoint && <button type="button" onClick={onConvertSelectedPoint}>{selection.type==='station'?'切换为控制点':'切换为站点'}</button>}
    {selection.type==='waypoint'&&<span className="context-hint">拖动控制点改变线路形状；删除请在属性栏操作</span>}
    {selection.type==='structureNode'&&<span className="context-hint">拖动样式点可移动样式分界；修改样式或结构请选择对应线路段；删除请在属性栏操作</span>}
    {!pointSelection&&<button className="danger" onClick={onDelete}>删除</button>}
  </div></section>
}
