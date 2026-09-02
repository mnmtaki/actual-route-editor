import { useEffect, useState } from 'react'
import type { ActualRouteProject, Selection } from '../data/model'
import { LinePanel } from './LinePanel'
import { StyleDrawer } from './StyleDrawer'
import { Inspector } from './Inspector'
import type { OpeningPhasePath } from '../data/openingPhases'

export type MobileDrawerId = 'lines' | 'history' | 'style' | 'elements' | 'settings' | 'export' | 'inspector'

const entries: Array<{ id: MobileDrawerId; label: string }> = [
  { id: 'lines', label: '线路' },
  { id: 'history', label: '发展史' },
  { id: 'style', label: '样式' },
  { id: 'elements', label: '地图元素' },
  { id: 'settings', label: '设置' },
  { id: 'export', label: '导出' },
]

export function MobileShell({ project, selection, activeLineId, onSelectLine, onChange, onAddLine, onOpenPresentation, onAddText, onImportProject, onImportBackground, onExportProject, onExportSvg, onExportImage, onShareProject, onShareSvg, onFitAll, onZoomSelection, onDeleteSelection, onAddLineBadge, onPhasePreview, onStartPhaseDrawing, canUndo, canRedo, onUndo, onRedo, nativeFiles = false }: {
  project: ActualRouteProject; selection: Selection; activeLineId: string | null; onSelectLine: (id: string) => void; onChange: (project: ActualRouteProject) => void; onAddLine: () => void
  onOpenPresentation: () => void; onAddText: () => void; onImportProject: () => void; onImportBackground: () => void; onExportProject: () => void; onExportSvg: () => void; onExportImage: () => void; onShareProject: () => void; onShareSvg: () => void; onFitAll: () => void; onZoomSelection: () => void
  onDeleteSelection: () => void; onAddLineBadge: (lineId: string) => void; onPhasePreview: (path: OpeningPhasePath | null) => void; onStartPhaseDrawing: (phaseId: string, lineId: string, stationId: string | null) => void
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; nativeFiles?: boolean
}) {
  const [active, setActive] = useState<MobileDrawerId | null>(null)
  const close = () => setActive(null)
  const selectLine = (id: string) => { onSelectLine(id); close() }
  const activeLabel = active === 'inspector' ? '属性' : entries.find(entry => entry.id === active)?.label
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => document.documentElement.style.setProperty('--mobile-visual-viewport-height', `${Math.round(viewport.height)}px`)
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); document.documentElement.style.removeProperty('--mobile-visual-viewport-height') }
  }, [])
  return <div className="mobile-shell" data-testid="mobile-shell">
    <header className="mobile-topbar"><strong>{project.name}</strong><div>{selection&&<button className="mobile-inspector-button" aria-label="属性" onClick={()=>setActive('inspector')}>属性</button>}<button aria-label="撤销" onClick={onUndo} disabled={!canUndo}>↶</button><button aria-label="重做" onClick={onRedo} disabled={!canRedo}>↷</button></div></header>
    <nav className="mobile-primary-nav" aria-label="移动端一级入口">{entries.map(entry => <button key={entry.id} className={active === entry.id ? 'active' : ''} onClick={() => setActive(current => current === entry.id ? null : entry.id)}>{entry.label}</button>)}</nav>
    {active && <><button className="mobile-drawer-scrim" aria-label="关闭移动端面板" onClick={close}/><aside className="mobile-drawer" role="dialog" aria-modal="true" aria-label={activeLabel} onPointerDown={event => event.stopPropagation()}>
      {active !== 'style' && <header className="mobile-drawer-header"><h2>{activeLabel}</h2><button className="icon-button" aria-label="关闭移动端面板" onClick={close}>×</button></header>}
      <div className="mobile-drawer-body" onFocusCapture={event => requestAnimationFrame(() => event.target instanceof HTMLElement && event.target.scrollIntoView({ block: 'nearest' }))}>
        {active === 'lines' && <LinePanel project={project} selection={selection} activeLineId={activeLineId} onSelect={selectLine} onChange={onChange} onAddLine={() => { onAddLine(); close() }}/>}
        {active === 'inspector' && <Inspector embedded project={project} selection={selection} onChange={onChange} onDelete={() => { onDeleteSelection(); close() }} onAddLineBadge={onAddLineBadge} onPhasePreview={onPhasePreview} onStartPhaseDrawing={onStartPhaseDrawing}/>}
        {active === 'history' && <section className="mobile-drawer-section mobile-history"><button className="primary" onClick={() => { onOpenPresentation(); close() }}>打开发展史演示</button><div className="mobile-history-list">{[...project.openingPhases].sort((a,b)=>a.openedAt.localeCompare(b.openedAt)||a.id.localeCompare(b.id)).map(phase=>{const line=project.lines.find(item=>item.id===phase.lineId);return <button key={phase.id} onClick={()=>{onSelectLine(phase.lineId);setActive('inspector')}}><time>{phase.openedAt}</time><strong>{phase.name||'未命名阶段'}</strong><span>{line?.name||'未知线路'}</span></button>})}</div>{!project.openingPhases.length&&<p>尚未建立开通阶段；可在线路属性中添加。</p>}</section>}
        {active === 'style' && <StyleDrawer embedded project={project} onChange={onChange} onClose={close}/>}
        {active === 'elements' && <section className="mobile-drawer-section"><p>在地图中心添加文字后，可直接拖动位置。</p><button className="primary" onClick={() => { onAddText(); close() }}>添加自由文本</button></section>}
        {active === 'settings' && <section className="mobile-drawer-section"><button onClick={() => { onFitAll(); close() }}>适应全部</button><button onClick={() => { onZoomSelection(); close() }}>缩放到选择</button><button onClick={() => { onImportBackground(); close() }}>导入底图</button></section>}
        {active === 'export' && <section className="mobile-drawer-section"><button onClick={() => { onImportProject(); close() }}>导入工程 / AARC</button><button onClick={() => { onImportBackground(); close() }}>导入底图</button><button onClick={() => { onExportProject(); close() }}>{nativeFiles ? '保存 JSON 到手机' : '导出 JSON'}</button><button onClick={() => { onExportSvg(); close() }}>{nativeFiles ? '保存 SVG 到手机' : '导出 SVG'}</button><button onClick={() => { onExportImage(); close() }}>导出图片…</button><button onClick={() => { onShareProject(); close() }}>分享 JSON</button><button onClick={() => { onShareSvg(); close() }}>分享 SVG</button></section>}
      </div>
    </aside></>}
  </div>
}
