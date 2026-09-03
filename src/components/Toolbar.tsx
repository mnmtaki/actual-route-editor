import { useEffect, useRef, useState } from 'react'
import { BUILD_VERSION } from '../build'
import type { BasemapPath } from '../data/model'

type TopMenu = 'map-elements' | 'mobile-files' | 'import' | 'export' | 'more'

function TopDropdown({ id, label, openMenu, setOpenMenu, children, className = '' }: { id: TopMenu; label: string; openMenu: TopMenu | null; setOpenMenu: (menu: TopMenu | null) => void; children: React.ReactNode; className?: string }) {
  const open = openMenu === id
  return <div className={`toolbar-menu ${className}`}>
    <button type="button" className="toolbar-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpenMenu(open ? null : id)}>{label}▾</button>
    <div className={`toolbar-menu-popover ${open ? 'is-open' : ''}`} role={open ? 'menu' : undefined} aria-hidden={!open}>{children}</div>
  </div>
}

export function Toolbar({ canUndo, canRedo, undo, redo, fitAll, zoomSelection, importProject, importTopology, exportProject, exportSvg, exportImage = () => undefined, shareProject = () => undefined, shareSvg = () => undefined, importBackground, onNewLine, onAddText = () => undefined, onAddBasemapPath = () => undefined, basemapPaths, onSelectBasemapPath = () => undefined, onStyle, drawing, onFinish, onPresentation, nativeFiles = false }: {
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; fitAll: () => void; zoomSelection: () => void
  importProject: () => void; importTopology: () => void; exportProject: () => void; exportSvg: () => void; exportImage?: () => void; shareProject?: () => void; shareSvg?: () => void; importBackground: () => void; onNewLine: () => void; onAddText?: () => void; onAddBasemapPath?: (category: 'water' | 'terrain' | 'other') => void; basemapPaths?: BasemapPath[]; onSelectBasemapPath?: (id: string) => void; onStyle: () => void; drawing: boolean; onFinish: () => void; onPresentation: () => void; nativeFiles?: boolean
}) {
  const [openMenu, setOpenMenu] = useState<TopMenu | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-top-menu-open', Boolean(openMenu || aboutOpen))
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; if (aboutOpen) { setAboutOpen(false); event.preventDefault(); event.stopPropagation(); return } if (openMenu) { setOpenMenu(null); event.preventDefault(); event.stopPropagation() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); document.documentElement.removeAttribute('data-top-menu-open') }
  }, [aboutOpen, openMenu])
  const action = (run: () => void) => () => { run(); setOpenMenu(null) }
  return <header ref={rootRef} className="toolbar direct-toolbar">
    <div className="brand"><span className="brand-mark">AR</span><div><strong>实际走向绘制器</strong></div></div>
    <div className="tool-group creation-group">
      <button className="primary" onClick={drawing ? onFinish : onNewLine}>{drawing ? '完成绘制' : '＋ 新建线路'}</button>
      <TopDropdown id="map-elements" label="地图元素" openMenu={openMenu} setOpenMenu={setOpenMenu} className="map-elements-menu">
        <button role="menuitem" onClick={action(onAddText)}>添加自由文本</button>
        <button role="menuitem" onClick={action(() => onAddBasemapPath('water'))}>绘制水体路径</button>
        <button role="menuitem" onClick={action(() => onAddBasemapPath('terrain'))}>绘制地形路径</button>
        <button role="menuitem" onClick={action(() => onAddBasemapPath('other'))}>绘制其他底图路径</button>
        {basemapPaths?.map(path => <button role="menuitem" key={path.id} className="toolbar-basemap-item" onClick={action(() => onSelectBasemapPath(path.id))}>{path.name || '底图路径'}（z{path.zIndex}）</button>)}
      </TopDropdown>
      <button onClick={onStyle}>样式</button><button className="presentation-entry" onClick={onPresentation}>发展史</button>
    </div>
    <div className="tool-group mobile-core"><button onClick={undo} disabled={!canUndo}>撤销</button><button onClick={redo} disabled={!canRedo}>重做</button></div>
    <TopDropdown id="mobile-files" label="更多" openMenu={openMenu} setOpenMenu={setOpenMenu} className="mobile-files">
      <button role="menuitem" onClick={action(onAddText)}>添加自由文本</button><button role="menuitem" onClick={action(importProject)}>导入工程 / AARC</button><button role="menuitem" onClick={action(importBackground)}>导入底图</button><button role="menuitem" onClick={action(exportProject)}>{nativeFiles ? '保存 JSON 到手机' : '导出 JSON'}</button><button role="menuitem" onClick={action(exportSvg)}>{nativeFiles ? '保存 SVG 到手机' : '导出 SVG'}</button><button role="menuitem" onClick={action(exportImage)}>导出图片…</button><button role="menuitem" onClick={action(shareProject)}>分享 JSON</button><button role="menuitem" onClick={action(shareSvg)}>分享 SVG</button>
    </TopDropdown>
    <div className="tool-group desktop-tools"><button onClick={fitAll}>适应全部</button><button onClick={zoomSelection}>缩放到选择</button></div>
    <div className="tool-group push-right desktop-tools"><button onClick={importBackground}>底图</button>
      <TopDropdown id="import" label="导入" openMenu={openMenu} setOpenMenu={setOpenMenu}><button role="menuitem" onClick={action(importTopology)}>导入拓扑</button><button role="menuitem" onClick={action(importProject)}>导入工程 / AARC</button></TopDropdown>
      <TopDropdown id="export" label="导出" openMenu={openMenu} setOpenMenu={setOpenMenu}><button role="menuitem" onClick={action(exportProject)}>{nativeFiles ? '保存工程到手机' : '导出工程'}</button><button role="menuitem" onClick={action(exportSvg)}>{nativeFiles ? '保存矢量图到手机' : '导出矢量图'}</button><button role="menuitem" onClick={action(exportImage)}>导出图片…</button><button role="menuitem" onClick={action(shareProject)}>分享工程</button><button role="menuitem" onClick={action(shareSvg)}>分享矢量图</button></TopDropdown>
      <TopDropdown id="more" label="更多" openMenu={openMenu} setOpenMenu={setOpenMenu}><button role="menuitem" onClick={() => { setOpenMenu(null); setAboutOpen(true) }}>关于</button></TopDropdown>
    </div>
    {aboutOpen && <div className="about-dialog" role="dialog" aria-label="关于" onClick={event => { if (event.target === event.currentTarget) setAboutOpen(false) }}><div className="about-dialog-card"><button className="icon-button" aria-label="关闭关于" onClick={() => setAboutOpen(false)}>×</button><strong>实际走向绘制器</strong><small>版本 {BUILD_VERSION}</small></div></div>}
  </header>
}
