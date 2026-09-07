import { useEffect, useRef, useState } from 'react'
import { BUILD_VERSION } from '../build'
import { normalizeProjectName } from '../data/projectMetadata'
import type { BasemapPath, LineLegend } from '../data/model'

type TopMenu = 'map-elements' | 'import' | 'export' | 'more'

/** Shared solid down-triangle used by every toolbar dropdown trigger. */
export function DropdownArrow() {
  return <svg data-testid="dropdown-arrow" className="dropdown-arrow" aria-hidden="true" viewBox="0 0 10 6" focusable="false"><path d="M1 1l4 4 4-4Z" /></svg>
}

function TopDropdown({ id, label, openMenu, setOpenMenu, children, className = '' }: { id: TopMenu; label: string; openMenu: TopMenu | null; setOpenMenu: (menu: TopMenu | null) => void; children: React.ReactNode; className?: string }) {
  const open = openMenu === id
  return <div className={`toolbar-menu ${className}`}>
    <button type="button" className="toolbar-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpenMenu(open ? null : id)}><span>{label}</span><DropdownArrow /></button>
    <div className={`toolbar-menu-popover ${open ? 'is-open' : ''}`} role={open ? 'menu' : undefined} aria-hidden={!open}>{children}</div>
  </div>
}

export function Toolbar({ canUndo, canRedo, undo, redo, fitAll, zoomSelection, importProject, importTopology, exportProject, exportSvg, exportImage = () => undefined, shareProject: _shareProject = () => undefined, shareSvg: _shareSvg = () => undefined, importBackground, onNewLine, onAddText = () => undefined, onAddRoad = () => undefined, onAddBasemapPath = () => undefined, onAddLineLegend = () => undefined, onSelectLineLegend = () => undefined, lineLegend, basemapPaths, onSelectBasemapPath = () => undefined, onStyle, onSettings = () => undefined, drawing, onFinish, onPresentation, nativeFiles = false, projectName = '未命名工程', onProjectNameChange = () => undefined }: {
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; fitAll: () => void; zoomSelection: () => void
  importProject: () => void; importTopology: () => void; exportProject: () => void; exportSvg: () => void; exportImage?: () => void; shareProject?: () => void; shareSvg?: () => void; importBackground: () => void; onNewLine: () => void; onAddText?: () => void; onAddRoad?: () => void; onAddBasemapPath?: (category: 'water' | 'terrain' | 'other') => void; onAddLineLegend?: () => void; onSelectLineLegend?: () => void; lineLegend?: LineLegend; basemapPaths?: BasemapPath[]; onSelectBasemapPath?: (id: string) => void; onStyle: () => void; onSettings?: () => void; drawing: boolean; onFinish: () => void; onPresentation: () => void; nativeFiles?: boolean; projectName?: string; onProjectNameChange?: (name: string) => void
}) {
  const [openMenu, setOpenMenu] = useState<TopMenu | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(projectName)
  const nameEditingRef = useRef(false)
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!nameEditingRef.current) setNameDraft(projectName)
  }, [projectName])
  useEffect(() => {
    document.documentElement.toggleAttribute('data-top-menu-open', Boolean(openMenu || aboutOpen))
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; if (aboutOpen) { setAboutOpen(false); event.preventDefault(); event.stopPropagation(); return } if (openMenu) { setOpenMenu(null); event.preventDefault(); event.stopPropagation() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); document.documentElement.removeAttribute('data-top-menu-open') }
  }, [aboutOpen, openMenu])
  const action = (run: () => void) => () => { run(); setOpenMenu(null) }
  const beginNameEdit = () => { nameEditingRef.current = true; setNameDraft(projectName); setNameEditing(true) }
  const cancelNameEdit = () => { nameEditingRef.current = false; setNameDraft(projectName); setNameEditing(false) }
  const commitName = () => {
    if (!nameEditingRef.current) return
    nameEditingRef.current = false
    setNameEditing(false)
    const next = normalizeProjectName(nameDraft)
    if (next !== normalizeProjectName(projectName)) onProjectNameChange(next)
  }
  return <header ref={rootRef} className="toolbar direct-toolbar">
    <div className="brand"><span className="brand-mark">AR</span><div className="brand-copy"><strong>实际走向绘制器</strong>{nameEditing ? <input autoFocus aria-label="工程名称" className="brand-project-name-input" value={nameDraft} onChange={event => setNameDraft(event.currentTarget.value)} onBlur={commitName} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitName() } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelNameEdit() } }} /> : <button type="button" className="brand-project-name" aria-label="当前工程名称" onClick={beginNameEdit}>{projectName}</button>}</div></div>
    <div className="tool-group creation-group">
      <button className="primary" onClick={drawing ? onFinish : onNewLine}>{drawing ? '完成绘制' : '＋ 新建线路'}</button>
      <TopDropdown id="map-elements" label="地图元素" openMenu={openMenu} setOpenMenu={setOpenMenu} className="map-elements-menu">
        <button role="menuitem" onClick={action(onAddText)}>添加自由文本</button>
        <button role="menuitem" onClick={action(onAddLineLegend)}>添加线路图例</button>
        {lineLegend && <button role="menuitem" onClick={action(onSelectLineLegend)}>选择线路图例</button>}
        <button role="menuitem" onClick={action(onAddRoad)}>绘制道路</button>
        <button role="menuitem" onClick={action(() => onAddBasemapPath('water'))}>绘制水体路径</button>
        <button role="menuitem" onClick={action(() => onAddBasemapPath('terrain'))}>绘制地形路径</button>
        <button role="menuitem" onClick={action(() => onAddBasemapPath('other'))}>绘制其他底图路径</button>
        {basemapPaths?.map(path => <button role="menuitem" key={path.id} className="toolbar-basemap-item" onClick={action(() => onSelectBasemapPath(path.id))}>{path.name || '底图路径'}（z{path.zIndex}）</button>)}
      </TopDropdown>
      <button onClick={onStyle}>样式</button><button className="presentation-entry" onClick={onPresentation}>发展史</button>
    </div>
    <div className="tool-group mobile-core"><button onClick={undo} disabled={!canUndo}>撤销</button><button onClick={redo} disabled={!canRedo}>重做</button></div>
    <div className="tool-group desktop-tools"><button onClick={fitAll}>适应全部</button><button onClick={zoomSelection}>缩放到选择</button></div>
    <div className="tool-group push-right desktop-tools">
      <TopDropdown id="import" label="导入" openMenu={openMenu} setOpenMenu={setOpenMenu}><button role="menuitem" onClick={action(importTopology)}>导入拓扑</button><button role="menuitem" onClick={action(importProject)}>导入工程 / AARC</button><button role="menuitem" onClick={action(importBackground)}>导入底图</button></TopDropdown>
      <TopDropdown id="export" label="导出" openMenu={openMenu} setOpenMenu={setOpenMenu}><button role="menuitem" onClick={action(exportProject)}>{nativeFiles ? '保存工程到手机' : '导出工程'}</button><button role="menuitem" onClick={action(exportSvg)}>{nativeFiles ? '保存矢量图到手机' : '导出矢量图'}</button><button role="menuitem" onClick={action(exportImage)}>导出图片…</button></TopDropdown>
      <TopDropdown id="more" label="更多" openMenu={openMenu} setOpenMenu={setOpenMenu}><button role="menuitem" onClick={() => { setOpenMenu(null); onSettings() }}>设置</button><button role="menuitem" onClick={() => { setOpenMenu(null); setAboutOpen(true) }}>关于</button></TopDropdown>
    </div>
    {aboutOpen && <div className="about-dialog" role="dialog" aria-label="关于" onClick={event => { if (event.target === event.currentTarget) setAboutOpen(false) }}><div className="about-dialog-card"><button className="icon-button" aria-label="关闭关于" onClick={() => setAboutOpen(false)}>×</button><strong>实际走向绘制器</strong><small>版本 {BUILD_VERSION}</small></div></div>}
  </header>
}
