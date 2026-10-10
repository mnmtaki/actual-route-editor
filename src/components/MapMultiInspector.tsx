import type { ActualRouteProject } from '../data/model'
import type { MapItemSelection } from '../data/mapMarquee'

const names: Record<MapItemSelection['type'], string> = {
  line: '线路', station: '车站', segment: '线路区间', waypoint: '路径点',
  structureNode: '样式点', lineLabel: '线路标签', mapElement: '自由文本',
  road: '道路', roadPoint: '道路节点', basemapPath: '底图路径',
  lineLegend: '线路图例', background: '底图图片',
}

export function MapMultiInspector({ project, selections, onClear, onChoose }: {
  project: ActualRouteProject
  selections: MapItemSelection[]
  onClear: () => void
  onChoose: (selection: MapItemSelection) => void
}) {
  const counts = new Map<string, number>()
  for (const selection of selections) counts.set(names[selection.type], (counts.get(names[selection.type]) ?? 0) + 1)
  const label = (selection: MapItemSelection) => {
    if (selection.type === 'station') return project.stations.find(item => item.id === selection.id)?.name ?? selection.id
    if (selection.type === 'line') return project.lines.find(item => item.id === selection.id)?.name ?? selection.id
    if (selection.type === 'road') return project.roads?.find(item => item.id === selection.id)?.name || selection.id
    if (selection.type === 'basemapPath') return project.basemapPaths?.find(item => item.id === selection.id)?.name || selection.id
    if (selection.type === 'mapElement') return project.mapElements?.find(item => item.id === selection.id)?.text.slice(0, 26) || selection.id
    return selection.type === 'background' ? '底图图片' : selection.id
  }
  return <aside className="right-panel panel map-multi-inspector" data-testid="map-multi-inspector">
    <div className="panel-heading"><div><h2>地图多选</h2><span className="panel-subtitle">已选择 {selections.length} 个对象</span></div></div>
    <div className="inspector-body">
      <p className="meta-note">框选模式下可用鼠标拖选。点击“追加”可将新框选结果加入当前选择。选择不同类型的对象时，不自动执行混合批量删除。</p>
      <div className="map-selection-summary">{[...counts].map(([name, count]) => <span key={name}>{name} {count}</span>)}</div>
      <button type="button" onClick={onClear}>清空选择</button>
      <div className="map-selection-items">{selections.slice(0, 100).map((item, index) => <button type="button" key={item.type + ':' + (item.type === 'background' ? 'background' : item.id) + ':' + index} onClick={() => onChoose(item)}>{names[item.type]}：{label(item)}</button>)}</div>
      {selections.length > 100 && <p className="meta-note">其余 {selections.length - 100} 个对象已选中，但未在列表展开。</p>}
    </div>
  </aside>
}
