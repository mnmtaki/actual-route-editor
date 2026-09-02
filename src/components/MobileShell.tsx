import { useState } from 'react'
import type { ActualRouteProject, Selection } from '../data/model'
import { LinePanel } from './LinePanel'
import { StyleDrawer } from './StyleDrawer'

export type MobileDrawerId = 'lines' | 'history' | 'style' | 'elements' | 'settings' | 'export'

const entries: Array<{ id: MobileDrawerId; label: string }> = [
  { id: 'lines', label: '线路' },
  { id: 'history', label: '发展史' },
  { id: 'style', label: '样式' },
  { id: 'elements', label: '地图元素' },
  { id: 'settings', label: '设置' },
  { id: 'export', label: '导出' },
]

export function MobileShell({ project, selection, activeLineId, onSelectLine, onChange, onAddLine, onOpenPresentation, onAddText, onImportProject, onImportBackground, onExportProject, onExportSvg, onExportImage, onShareProject, onShareSvg, onFitAll, onZoomSelection, canUndo, canRedo, onUndo, onRedo, nativeFiles = false }: {
  project: ActualRouteProject; selection: Selection; activeLineId: string | null; onSelectLine: (id: string) => void; onChange: (project: ActualRouteProject) => void; onAddLine: () => void
  onOpenPresentation: () => void; onAddText: () => void; onImportProject: () => void; onImportBackground: () => void; onExportProject: () => void; onExportSvg: () => void; onExportImage: () => void; onShareProject: () => void; onShareSvg: () => void; onFitAll: () => void; onZoomSelection: () => void
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; nativeFiles?: boolean
}) {
  const [active, setActive] = useState<MobileDrawerId | null>(null)
  const close = () => setActive(null)
  const selectLine = (id: string) => { onSelectLine(id); close() }
  return <div className="mobile-shell" data-testid="mobile-shell">
    <header className="mobile-topbar"><strong>{project.name}</strong><div><button aria-label="撤销" onClick={onUndo} disabled={!canUndo}>↶</button><button aria-label="重做" onClick={onRedo} disabled={!canRedo}>↷</button></div></header>
    <nav className="mobile-primary-nav" aria-label="移动端一级入口">{entries.map(entry => <button key={entry.id} className={active === entry.id ? 'active' : ''} onClick={() => setActive(current => current === entry.id ? null : entry.id)}>{entry.label}</button>)}</nav>
    {active && <><button className="mobile-drawer-scrim" aria-label="关闭移动端面板" onClick={close}/><aside className="mobile-drawer" role="dialog" aria-modal="true" aria-label={entries.find(entry => entry.id === active)?.label}>
      {active !== 'style' && <header className="mobile-drawer-header"><h2>{entries.find(entry => entry.id === active)?.label}</h2><button className="icon-button" aria-label="关闭移动端面板" onClick={close}>×</button></header>}
      <div className="mobile-drawer-body">
        {active === 'lines' && <LinePanel project={project} selection={selection} activeLineId={activeLineId} onSelect={selectLine} onChange={onChange} onAddLine={() => { onAddLine(); close() }}/>}
        {active === 'history' && <section className="mobile-drawer-section"><p>进入正式演示后，可播放、拖动进度并调整演示设置。</p><button className="primary" onClick={() => { onOpenPresentation(); close() }}>打开发展史演示</button></section>}
        {active === 'style' && <StyleDrawer embedded project={project} onChange={onChange} onClose={close}/>}
        {active === 'elements' && <section className="mobile-drawer-section"><p>在地图中心添加文字后，可直接拖动位置。</p><button className="primary" onClick={() => { onAddText(); close() }}>添加自由文本</button></section>}
        {active === 'settings' && <section className="mobile-drawer-section"><button onClick={() => { onFitAll(); close() }}>适应全部</button><button onClick={() => { onZoomSelection(); close() }}>缩放到选择</button><button onClick={() => { onImportBackground(); close() }}>导入底图</button></section>}
        {active === 'export' && <section className="mobile-drawer-section"><button onClick={() => { onImportProject(); close() }}>导入工程 / AARC</button><button onClick={() => { onExportProject(); close() }}>{nativeFiles ? '保存 JSON 到手机' : '导出 JSON'}</button><button onClick={() => { onExportSvg(); close() }}>{nativeFiles ? '保存 SVG 到手机' : '导出 SVG'}</button><button onClick={() => { onExportImage(); close() }}>导出图片…</button><button onClick={() => { onShareProject(); close() }}>分享 JSON</button><button onClick={() => { onShareSvg(); close() }}>分享 SVG</button></section>}
      </div>
    </aside></>}
  </div>
}
