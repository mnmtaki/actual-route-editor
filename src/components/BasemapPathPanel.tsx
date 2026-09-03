import type { ActualRouteProject, BasemapPathCategory } from '../data/model'

const labels: Record<BasemapPathCategory, string> = { water: '水体', terrain: '地形', other: '其他底图路径' }

export function BasemapPathPanel({ project, selectedId, onSelect, onAdd }: { project: ActualRouteProject; selectedId?: string; onSelect: (id: string) => void; onAdd: (category: BasemapPathCategory) => void }) {
  return <section className="mobile-drawer-section basemap-path-panel" data-testid="basemap-path-panel">
    <div className="eyebrow">矢量底图路径</div>
    <p className="meta-note">点击地图添加连续节点，完成后可在属性中调整颜色、填充和层级。</p>
    <div className="basemap-path-add-actions"><button onClick={() => onAdd('water')}>绘制水体</button><button onClick={() => onAdd('terrain')}>绘制地形</button><button onClick={() => onAdd('other')}>绘制其他路径</button></div>
    <div className="basemap-path-list">{(project.basemapPaths ?? []).map(path => <button type="button" key={path.id} className={selectedId === path.id ? 'active' : ''} onClick={() => onSelect(path.id)}><span className="basemap-path-swatch" style={{ background: path.color }} /><span>{path.name || labels[path.category]}</span><small>{path.points.length} 个节点 · z {path.zIndex}</small></button>)}{!(project.basemapPaths ?? []).length && <p className="meta-note">还没有矢量底图路径。</p>}</div>
  </section>
}
