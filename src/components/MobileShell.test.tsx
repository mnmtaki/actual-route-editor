import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import type { Selection } from '../data/model'
import { MobileShell } from './MobileShell'

const renderShell = (selection: Selection = null) => render(<MobileShell project={structuredClone(demoProject)} selection={selection} activeLineId={demoProject.lines[0].id} onSelectLine={vi.fn()} onChange={vi.fn()} onAddLine={vi.fn()} onOpenPresentation={vi.fn()} onAddText={vi.fn()} onImportProject={vi.fn()} onImportBackground={vi.fn()} onExportProject={vi.fn()} onExportSvg={vi.fn()} onExportImage={vi.fn()} onShareProject={vi.fn()} onShareSvg={vi.fn()} onFitAll={vi.fn()} onZoomSelection={vi.fn()} onDeleteSelection={vi.fn()} onAddLineBadge={vi.fn()} onPhasePreview={vi.fn()} onStartPhaseDrawing={vi.fn()} canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()}/>)

describe('MobileShell', () => {
  it('provides the six fixed first-level entry points including history', () => {
    renderShell()
    expect(screen.getByTestId('mobile-shell')).toBeTruthy()
    for (const label of ['线路', '发展史', '样式', '地图元素', '设置', '导出']) expect(screen.getByRole('button', { name: label })).toBeTruthy()
  })

  it('opens, switches and closes the shared right-side drawer', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: '线路' }))
    expect(screen.getByRole('dialog', { name: '线路' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '样式' }))
    expect(screen.getByRole('dialog', { name: '样式' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭全局样式' }))
    expect(screen.queryByRole('dialog', { name: '样式' })).toBeNull()
  })

  it('opens the existing Inspector for a selected mobile object', () => {
    renderShell({ type: 'station', id: 's1' })
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    expect(screen.getByRole('dialog', { name: '属性' })).toBeTruthy()
    expect(screen.getByLabelText('站名距离')).toHaveAttribute('inputmode', 'decimal')
  })

  it('keeps project, AARC, background import and image export in the mobile export drawer', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('button', { name: '导入工程 / AARC' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '导入底图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出图片…' })).toBeTruthy()
  })

  it('does not expose the temporary JSON or SVG share actions', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.queryByRole('button', { name: '分享 JSON' })).toBeNull()
    expect(screen.queryByRole('button', { name: '分享 SVG' })).toBeNull()
    expect(screen.queryByRole('button', { name: '分享工程' })).toBeNull()
    expect(screen.queryByRole('button', { name: '分享矢量图' })).toBeNull()
  })
  it('enters shared line multi-select mode on a long press and exposes batch actions', () => {
    vi.useFakeTimers()
    const onStart = vi.fn(), onToggle = vi.fn(), onVisible = vi.fn(), onLocked = vi.fn(), onDelete = vi.fn()
    const view = render(<MobileShell project={structuredClone(demoProject)} selection={null} activeLineId={demoProject.lines[0].id} selectedLineIds={['line-a']} onSelectLine={vi.fn()} onStartLineMultiSelect={onStart} onToggleLineSelection={onToggle} onBatchSetLinesVisible={onVisible} onBatchSetLinesLocked={onLocked} onBatchDeleteLines={onDelete} onChange={vi.fn()} onAddLine={vi.fn()} onOpenPresentation={vi.fn()} onAddText={vi.fn()} onImportProject={vi.fn()} onImportBackground={vi.fn()} onExportProject={vi.fn()} onExportSvg={vi.fn()} onExportImage={vi.fn()} onShareProject={vi.fn()} onShareSvg={vi.fn()} onFitAll={vi.fn()} onZoomSelection={vi.fn()} onDeleteSelection={vi.fn()} onAddLineBadge={vi.fn()} onPhasePreview={vi.fn()} onStartPhaseDrawing={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} />)
    fireEvent.click(screen.getByRole('button', { name: '线路' }))
    const row = view.container.querySelector('[data-line-id="line-a"]')!
    fireEvent.pointerDown(row, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => { vi.advanceTimersByTime(520) })
    expect(onStart).toHaveBeenCalledWith('line-a')
    expect(screen.queryByText('长按线路进入多选模式')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '全部隐藏' }))
    fireEvent.click(screen.getByRole('button', { name: '全部锁定' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选线路' }))
    expect(onVisible).toHaveBeenCalledWith(false)
    expect(onLocked).toHaveBeenCalledWith(true)
    expect(onDelete).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('exposes existing Segment actions in the mobile Inspector drawer', () => {
    const onAddWaypoint = vi.fn(), onInsertStation = vi.fn(), onStructure = vi.fn()
    render(<MobileShell project={structuredClone(demoProject)} selection={{ type: 'segment', id: 'a-1' }} activeLineId={demoProject.lines[0].id} onSelectLine={vi.fn()} onChange={vi.fn()} onAddLine={vi.fn()} onOpenPresentation={vi.fn()} onAddText={vi.fn()} onImportProject={vi.fn()} onImportBackground={vi.fn()} onExportProject={vi.fn()} onExportSvg={vi.fn()} onExportImage={vi.fn()} onShareProject={vi.fn()} onShareSvg={vi.fn()} onFitAll={vi.fn()} onZoomSelection={vi.fn()} onDeleteSelection={vi.fn()} onAddLineBadge={vi.fn()} onPhasePreview={vi.fn()} onStartPhaseDrawing={vi.fn()} onInsertStation={onInsertStation} onAddWaypoint={onAddWaypoint} onStructureChange={onStructure} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} />)
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    fireEvent.click(screen.getByRole('button', { name: '＋站点' }))
    fireEvent.click(screen.getByRole('button', { name: '＋路径点' }))
    expect(onInsertStation).toHaveBeenCalledTimes(1)
    expect(onAddWaypoint).toHaveBeenCalledTimes(1)
    const select = screen.getByLabelText('线路结构')
    fireEvent.change(select, { target: { value: 'elevated' } })
    expect(onStructure).toHaveBeenCalledWith('elevated')
  })
})
