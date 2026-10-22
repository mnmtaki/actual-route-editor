import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { ContextActions } from './ContextActions'

const baseProps = {
  project: demoProject,
  selection: { type: 'segment' as const, id: 'a-1', progress: .35 },
  onExtend: vi.fn(),
  onInsertStation: vi.fn(),
  onAddWaypoint: vi.fn(),
  onStraighten: vi.fn(),
  onStructureChange: vi.fn(),
  onDelete: vi.fn(),
}

describe('segment quick actions', () => {
  it('offers +线路标签 on selected segment and passes its line and position', () => {
    const onAddLineBadge = vi.fn()
    render(<ContextActions {...baseProps} onAddLineBadge={onAddLineBadge} />)
    fireEvent.click(screen.getByRole('button', { name: '＋线路标签' }))
    expect(onAddLineBadge).toHaveBeenCalledExactlyOnceWith('line-a', 'a-1', .35)
    expect(screen.getByRole('button', { name: '＋站点' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '＋控制点' })).toBeInTheDocument()
  })

  it('defaults the badge placement to the selected segment midpoint', () => {
    const onAddLineBadge = vi.fn()
    render(<ContextActions {...baseProps} selection={{ type: 'segment', id: 'a-1' }} onAddLineBadge={onAddLineBadge} />)
    fireEvent.click(screen.getByRole('button', { name: '＋线路标签' }))
    expect(onAddLineBadge).toHaveBeenCalledExactlyOnceWith('line-a', 'a-1', .5)
  })

  it('does not show segment-only badge action on a station', () => {
    const onAddLineBadge = vi.fn()
    render(<ContextActions {...baseProps} selection={{ type: 'station', id: 's4' }} onAddLineBadge={onAddLineBadge} />)
    expect(screen.queryByRole('button', { name: '＋线路标签' })).toBeNull()
  })
})
