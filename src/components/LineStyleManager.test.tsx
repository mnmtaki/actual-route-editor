import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LineStyleManager } from './LineStyleManager'

describe('LineStyleManager', () => {
  it('lists built-in styles and creates a user style with editable layers', () => {
    const onChange = vi.fn()
    render(<LineStyleManager project={structuredClone(demoProject)} onChange={onChange} />)
    expect(screen.getByText('线路图层')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    const next = onChange.mock.calls.at(-1)?.[0]
    expect(next.styles).toHaveLength(3)
    expect(next.styles.at(-1).layers).toHaveLength(1)
  })

  it('supports custom color, absolute width and layer ordering', () => {
    const onChange = vi.fn(), project = structuredClone(demoProject)
    project.styles = [{ id: 'custom', name: '自定义', layers: [{ id: 'one', colorMode: 'followLine', width: 1 }] }]
    render(<LineStyleManager project={project} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('线路样式管理'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('宽度方式'), { target: { value: 'absolute' } })
    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText('颜色方式'), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加图层' }))
    const next = onChange.mock.calls.at(-1)?.[0]
    expect(next.styles.find((style:{id:string}) => style.id === 'custom').layers).toHaveLength(2)
  })

  it('falls lines back to ordinary when a user style is deleted', () => {
    const onChange = vi.fn(), project = structuredClone(demoProject)
    project.styles = [{ id: 'custom', name: '自定义', layers: [{ id: 'one', colorMode: 'followLine', width: 1 }] }]
    project.lines[0].lineStyleId = 'custom'
    render(<LineStyleManager project={project} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('线路样式管理'), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onChange.mock.calls.at(-1)?.[0].lines[0].lineStyleId).toBe('normal')
  })
})
