import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ActualRouteProject, Selection } from '../data/model'
import { getSegmentCurveLength } from '../geometry/path'
import { worldUnitsToKilometers } from '../data/distance'
import { setLineLocked, setLineVisibility } from '../data/editorCommands'
import { getEffectiveLineColor, getLineDisplayName } from '../data/lineIdentity'

function EyeIcon({ hidden = false }: { hidden?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="line-state-icon"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />{!hidden && <circle cx="12" cy="12" r="2.5" fill="currentColor" />}{hidden && <path d="m4 4 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
}

function LockIcon({ locked = false }: { locked?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="line-state-icon"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />{locked ? <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M9 10V7a3 3 0 0 1 5.5-1.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
}

type LineSelectionModifiers = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }


type MarqueeState = {
  pointerId: number
  rowId: string | null
  startX: number
  startY: number
  currentX: number
  currentY: number
  additive: boolean
  active: boolean
}

export function LinePanel({
  project,
  selection,
  activeLineId,
  selectedLineIds = [],
  onSelect,
  onSelectionChange,
  onClearSelection,
  onChange,
  onAddLine,
  mobileMode = false,
  onMobileLongPress,
}: {
  project: ActualRouteProject
  selection: Selection
  activeLineId: string | null
  selectedLineIds?: string[]
  onSelect: (id: string, modifiers?: LineSelectionModifiers) => void
  onSelectionChange?: (ids: string[], additive: boolean) => void
  onClearSelection?: () => void
  onChange: (project: ActualRouteProject) => void
  onAddLine: () => void
  mobileMode?: boolean
  onMobileLongPress?: (lineId: string) => void
}) {
  const lineStats = project.lines.map(line => ({ line, length: worldUnitsToKilometers(project.geometry.segments.filter(segment => segment.lineId === line.id).reduce((sum, segment) => sum + getSegmentCurveLength(project, segment), 0), project), stations: new Set(line.stationSequence).size }))
  const childrenByParent = new Map<string, typeof project.lines>(); project.lines.forEach(line => { if (line.parentLineId) childrenByParent.set(line.parentLineId, [...(childrenByParent.get(line.parentLineId) ?? []), line]) });
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(new Set())
  const displayLines: Array<{ line: typeof project.lines[number]; depth: number }> = []; const visited = new Set<string>(); const appendLine = (line: typeof project.lines[number], depth: number) => { if (visited.has(line.id)) return; visited.add(line.id); displayLines.push({ line, depth }); if (!collapsedParentIds.has(line.id)) for (const child of childrenByParent.get(line.id) ?? []) appendLine(child, depth + 1) }; for (const line of project.lines.filter(item => !item.parentLineId || !project.lines.some(parent => parent.id === item.parentLineId))) appendLine(line, 0); for (const line of project.lines) appendLine(line, 0)
  const totalLength = lineStats.reduce((sum, item) => sum + item.length, 0)
  const totalStations = new Set(project.stationLineRelations.map(relation => relation.stationId)).size
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const marqueeRef = useRef<MarqueeState | null>(null)
  const autoScrollFrame = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const touchLongPressTimer = useRef<number | null>(null)
  const touchLongPress = useRef<{ pointerId: number; lineId: string; x: number; y: number; triggered: boolean } | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const clearTouchLongPress = () => {
    if (touchLongPressTimer.current !== null) window.clearTimeout(touchLongPressTimer.current)
    touchLongPressTimer.current = null
    touchLongPress.current = null
  }
  const beginTouchLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Real browsers report touch; jsdom and some embedded runtimes may leave pointerType empty.
    if (!mobileMode || (event.pointerType !== 'touch' && Boolean(event.pointerType))) return
    const target = event.target as Element | null
    if (target?.closest('.line-state-button')) return
    const row = target?.closest('[data-line-id]') as HTMLElement | null
    const lineId = row?.dataset.lineId
    if (!lineId) return
    clearTouchLongPress()
    const state = { pointerId: event.pointerId, lineId, x: event.clientX, y: event.clientY, triggered: false }
    touchLongPress.current = state
    touchLongPressTimer.current = window.setTimeout(() => {
      if (touchLongPress.current?.pointerId !== state.pointerId) return
      state.triggered = true
      suppressClick.current = true
      onMobileLongPress?.(state.lineId)
    }, 520)
  }
  const moveTouchLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = touchLongPress.current
    if (!state || state.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 10) clearTouchLongPress()
  }
  const endTouchLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (touchLongPress.current?.pointerId === event.pointerId) {
      if (touchLongPress.current.triggered) suppressClick.current = true
      clearTouchLongPress()
    }
  }
  const selected = new Set(selectedLineIds)
  if (selection?.type === 'line') selected.add(selection.id)

  const cancelAutoScroll = () => {
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current)
    autoScrollFrame.current = null
  }
  const hitRows = (state: MarqueeState) => {
    const left = Math.min(state.startX, state.currentX)
    const right = Math.max(state.startX, state.currentX)
    const top = Math.min(state.startY, state.currentY)
    const bottom = Math.max(state.startY, state.currentY)
    return project.lines.filter(line => {
      const row = rowRefs.current.get(line.id)
      if (!row) return false
      const rect = row.getBoundingClientRect()
      return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom
    }).map(line => line.id)
  }
  const updateMarqueeRect = (state: MarqueeState) => setMarquee({ ...state })
  const scheduleAutoScroll = () => {
    const state = marqueeRef.current
    const list = listRef.current
    if (!state?.active || !list) return
    const rect = list.getBoundingClientRect()
    const edge = 32
    const velocity = state.currentY < rect.top + edge ? -14 : state.currentY > rect.bottom - edge ? 14 : 0
    if (!velocity) { cancelAutoScroll(); return }
    if (autoScrollFrame.current !== null) return
    const tick = () => {
      autoScrollFrame.current = null
      const current = marqueeRef.current
      const target = listRef.current
      if (!current?.active || !target) return
      target.scrollTop += velocity
      const next = { ...current }
      updateMarqueeRect(next)
      scheduleAutoScroll()
    }
    autoScrollFrame.current = requestAnimationFrame(tick)
  }
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    endTouchLongPress(event)
    const state = marqueeRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const list = listRef.current
    if (list?.hasPointerCapture?.(event.pointerId)) list.releasePointerCapture(event.pointerId)
    cancelAutoScroll()
    marqueeRef.current = null
    setMarquee(null)
    if (cancelled) { suppressClick.current = false; return }
    suppressClick.current = true
    if (state.active) onSelectionChange?.(hitRows(state), state.additive)
    else if (state.rowId) onSelect(state.rowId, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
    else onClearSelection?.()
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    beginTouchLongPress(event)
    if (event.pointerType === 'touch' || event.pointerType === 'pen' || event.button !== 0 || (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 699px)').matches)) return
    const target = event.target as Element | null
    if (target?.closest('.line-state-button')) return
    const list = listRef.current
    if (!list) return
    const listRect = list.getBoundingClientRect()
    if (target === list && event.clientX > listRect.right - 16) return
    const row = target?.closest('[data-line-id]') as HTMLElement | null
    const state: MarqueeState = { pointerId: event.pointerId, rowId: row?.dataset.lineId ?? null, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY, additive: event.ctrlKey || event.metaKey, active: false }
    marqueeRef.current = state
    setMarquee(state)
    list.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    moveTouchLongPress(event)
    const current = marqueeRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = { ...current, currentX: event.clientX, currentY: event.clientY }
    if (!next.active && Math.hypot(next.currentX - next.startX, next.currentY - next.startY) >= 5) next.active = true
    marqueeRef.current = next
    if (next.active) updateMarqueeRect(next)
    scheduleAutoScroll()
  }
  const onClickMain = (event: React.MouseEvent, lineId: string) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    onSelect(lineId, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
  }
  useEffect(() => {
    const cancel = () => {
      cancelAutoScroll()
      marqueeRef.current = null
      setMarquee(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !marqueeRef.current) return
      event.preventDefault()
      cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', onKeyDown); cancel() }
  }, [])

  return <aside className="left-panel panel" aria-label="线路结构">
    <div className="panel-heading"><div><h2>线路</h2><span className="panel-subtitle">线路与图层</span></div><button className="icon-button" onClick={onAddLine} aria-label="新增线路">＋</button></div>
    <div ref={listRef} className="line-list" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={event => { endTouchLongPress(event); finishPointer(event, true) }} onContextMenu={event => { if (marqueeRef.current) event.preventDefault() }}>
      {displayLines.map(({ line, depth }) => {
        const isSelected = selected.has(line.id)
        const isActive = activeLineId === line.id
        const displayName = getLineDisplayName(project, line), color = getEffectiveLineColor(project, line), hasChildren = childrenByParent.has(line.id), collapsed = collapsedParentIds.has(line.id)
        return <div key={line.id} ref={node => { if (node) rowRefs.current.set(line.id, node); else rowRefs.current.delete(line.id) }} data-line-id={line.id} className={`line-row ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${isSelected && !isActive ? 'secondary-selected' : ''}`}>
          <button type="button" className="line-row-main" onClick={event => onClickMain(event, line.id)}>{hasChildren && <span className="line-tree-toggle" role="button" tabIndex={0} aria-label={collapsed ? '展开支线' : '折叠支线'} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setCollapsedParentIds(previous => { const next = new Set(previous); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next }) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setCollapsedParentIds(previous => { const next = new Set(previous); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next }) } }}>{collapsed ? '▸' : '▾'}</span>}<span aria-hidden="true" className="line-color" style={{ background: color }} /><span className="line-name">{depth ? "└ " : ""}{displayName}</span></button>
          <button type="button" className={`line-state-button ${line.visible ? 'is-on' : ''}`} aria-label={line.visible ? `${displayName}隐藏线路` : `${displayName}显示线路`} title={line.visible ? '隐藏线路' : '显示线路'} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={() => onChange(setLineVisibility(project, line.id, !line.visible))}><span aria-hidden="true"><EyeIcon hidden={!line.visible} /></span></button>
          <button type="button" className={`line-state-button ${line.locked ? 'is-on' : ''}`} aria-label={line.locked ? `${displayName}解锁线路` : `${displayName}锁定线路`} title={line.locked ? '解锁线路' : '锁定线路'} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={() => onChange(setLineLocked(project, line.id, !line.locked))}><span aria-hidden="true"><LockIcon locked={line.locked} /></span></button>
        </div>
      })}
      {marquee?.active && <div className="line-selection-marquee" data-testid="line-selection-marquee" style={{ left: `${Math.min(marquee.startX, marquee.currentX) - (listRef.current?.getBoundingClientRect().left ?? 0) + (listRef.current?.scrollLeft ?? 0)}px`, top: `${Math.min(marquee.startY, marquee.currentY) - (listRef.current?.getBoundingClientRect().top ?? 0) + (listRef.current?.scrollTop ?? 0)}px`, width: `${Math.abs(marquee.currentX - marquee.startX)}px`, height: `${Math.abs(marquee.currentY - marquee.startY)}px` }} />}
    </div>
    <details className="network-overview"><summary>线网概览</summary><div className="network-summary" aria-label="线网统计"><div className="network-total"><strong>全网</strong><span>{totalLength.toFixed(1)} km</span><span>{totalStations} 座车站</span></div><details className="network-line-details"><summary>查看线路详情</summary><div className="network-line-stats">{lineStats.map(({ line, length, stations }) => <div key={line.id}><i style={{ background: getEffectiveLineColor(project, line) }} /><strong>{getLineDisplayName(project, line)}</strong><span>{length.toFixed(1)} km</span><span>{stations} 站</span></div>)}</div></details></div></details>
    <details className="panel-help"><summary>操作提示</summary><p>直接拖动车站；拖动空白平移。选中车站可延伸线路，选中区间可插入车站或路径点。</p></details>
  </aside>
}
