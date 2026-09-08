import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { createRoadStyle } from '../data/roads'
import { RoadStyleManager } from './RoadStyleManager'
import { StyleDrawer } from './StyleDrawer'

describe('Style center navigation and road style editing', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the overview short and navigates line, station, name and display pages', () => {
    render(<StyleDrawer project={structuredClone(demoProject)} onChange={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('style-center-overview')).toBeTruthy()
    expect(screen.queryByTestId('layered-stroke-style-editor')).toBeNull()
    expect(screen.queryByLabelText('每公里地图单位')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /车站 普通站/ }))
    expect(screen.getByTestId('style-station-page')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /返回全局样式/ }))
    fireEvent.click(screen.getByRole('button', { name: /显示 网格/ }))
    expect(screen.getByTestId('style-display-page')).toBeTruthy()
  })

  it('opens the road style editor and sends real layer mutations', () => {
    const onChange = vi.fn()
    render(<StyleDrawer project={structuredClone(demoProject)} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /道路 道路样式库/ }))
    expect(screen.getByTestId('style-road-page')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑当前样式' }))
    expect(screen.getByTestId('road-style-editor-page')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect(onChange.mock.calls.at(-1)?.[0].roadStyles?.length).toBeGreaterThan(0)
  })

  it('supports RoadStyle copy and independent layer editing', () => {
    const seed = structuredClone(demoProject)
    const created = createRoadStyle(seed)
    const onChange = vi.fn()
    render(<RoadStyleManager project={created.project} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    const next = onChange.mock.calls.at(-1)?.[0]
    expect(next.roadStyles).toHaveLength(2)
    expect(next.roadStyles[0].layers).not.toBe(next.roadStyles[1].layers)
  })

  it('does not reset the project distance scale from style defaults', () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const project = structuredClone(demoProject)
    project.distanceScale = { metersPerWorldUnit: 25 }
    const onChange = vi.fn()
    render(<StyleDrawer project={project} onChange={onChange} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认样式' }))
    expect(onChange.mock.calls.at(-1)?.[0].distanceScale).toEqual({ metersPerWorldUnit: 25 })
  })
})
