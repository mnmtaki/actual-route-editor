import type { ActualRouteProject } from '../data/model'

export function LineMultiInspector({
  project,
  selectedLineIds,
  onChange: _onChange,
  onDelete,
  onSetVisible,
  onSetLocked,
}: {
  project: ActualRouteProject
  selectedLineIds: string[]
  onChange: (project: ActualRouteProject) => void
  onDelete: () => void
  onSetVisible: (value: boolean) => void
  onSetLocked: (value: boolean) => void
}) {
  void _onChange
  const lines = project.lines.filter(line => selectedLineIds.includes(line.id))
  const allVisible = lines.length > 0 && lines.every(line => line.visible)
  const noneVisible = lines.length > 0 && lines.every(line => !line.visible)
  const allLocked = lines.length > 0 && lines.every(line => line.locked)
  const noneLocked = lines.length > 0 && lines.every(line => !line.locked)
  return <aside className="right-panel panel line-batch-inspector" aria-label="批量线路属性">
    <div className="panel-heading"><div><h2>批量操作</h2><span className="panel-subtitle">线路</span></div></div>
    <div className="inspector-body">
      <p className="batch-selection-summary">已选择 {lines.length} 条线路</p>
      <section className="batch-inspector-section" aria-label="批量显示">
        <h3>显示状态</h3>
        <p>{allVisible ? '全部显示' : noneVisible ? '全部隐藏' : '混合状态'}</p>
        <div className="batch-action-row"><button type="button" onClick={() => onSetVisible(true)} disabled={allVisible}>全部显示</button><button type="button" onClick={() => onSetVisible(false)} disabled={noneVisible}>全部隐藏</button></div>
      </section>
      <section className="batch-inspector-section" aria-label="批量锁定">
        <h3>锁定状态</h3>
        <p>{allLocked ? '全部锁定' : noneLocked ? '全部未锁定' : '混合状态'}</p>
        <div className="batch-action-row"><button type="button" onClick={() => onSetLocked(true)} disabled={allLocked}>全部锁定</button><button type="button" onClick={() => onSetLocked(false)} disabled={noneLocked}>全部解锁</button></div>
      </section>
      <section className="batch-inspector-section">
        <h3>删除线路</h3>
        <p>已锁定线路不会被删除。</p>
        <button type="button" className="danger" onClick={onDelete}>删除所选线路</button>
      </section>
    </div>
  </aside>
}
