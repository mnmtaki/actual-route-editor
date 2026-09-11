import { useMemo } from 'react'
import type { ActualRouteProject } from '../data/model'
import { assignStationStyle, getStationStyles } from '../data/stationStyles'

export function StationMultiInspector({ project, selectedStationIds, onChange }: { project: ActualRouteProject; selectedStationIds: string[]; onChange: (project: ActualRouteProject) => void }) {
  const stations = useMemo(() => project.stations.filter(station => selectedStationIds.includes(station.id)), [project.stations, selectedStationIds])
  const styles = getStationStyles(project)
  if (stations.length < 2) return null
  const values = new Set(stations.map(station => station.stationStyleId ?? '__default__'))
  const value = values.size === 1 ? [...values][0] : '__mixed__'
  return <aside className="right-panel panel station-multi-inspector" data-testid="station-multi-inspector"><div className="panel-heading"><div><h2>车站样式</h2><span className="panel-subtitle">已选择 {stations.length} 个车站</span></div></div><div className="inspector-body"><label className="field"><span>批量应用样式</span><select aria-label="批量车站样式" value={value} onChange={event => { if (event.target.value === '__mixed__') return; onChange(assignStationStyle(project, stations.map(station => station.id), event.target.value === '__default__' ? undefined : event.target.value)) }}><option value="__mixed__">多个样式</option><option value="__default__">使用默认样式</option>{styles.map(style => <option key={style.id} value={style.id}>{style.name}{style.builtin ? '（内置）' : ''}</option>)}</select></label><p className="meta-note">一次应用到所选普通车站；换乘站仍保持现有胶囊和彩点视觉。</p></div></aside>
}
