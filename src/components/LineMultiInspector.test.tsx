import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LineMultiInspector } from './LineMultiInspector'

describe('batch line inspector', () => {
  it('shows mixed state and emits only supported batch actions', () => {
    const project = structuredClone(demoProject)
    project.lines[0].visible = true
    project.lines[1].visible = false
    project.lines[1].locked = true
    const onVisible = vi.fn()
    const onLocked = vi.fn()
    const onDelete = vi.fn()
    render(<LineMultiInspector project={project} selectedLineIds={project.lines.slice(0, 2).map(line => line.id)} onChange={() => {}} onDelete={onDelete} onSetVisible={onVisible} onSetLocked={onLocked} />)
    expect(screen.getByText('已选择 2 条线路')).toBeTruthy()
    expect(screen.getAllByText('混合状态')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '全部显示' }))
    fireEvent.click(screen.getByRole('button', { name: '全部解锁' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选线路' }))
    expect(onVisible).toHaveBeenCalledWith(true)
    expect(onLocked).toHaveBeenCalledWith(false)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
