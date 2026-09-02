import { fireEvent, render, screen } from '@testing-library/react'
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
})
