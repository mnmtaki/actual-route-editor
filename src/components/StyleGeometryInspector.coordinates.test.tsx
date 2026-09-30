import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { StyleGeometryInspector } from './StyleGeometryInspector'

describe('StyleGeometryInspector small editing helpers', () => {
  it('edits waypoint coordinates only when the input is committed', () => {
    const project = structuredClone(demoProject)
    const onChange = vi.fn()
    render(<StyleGeometryInspector project={project} selection={{ type: 'waypoint', id: 'w1', segmentId: 'a-1' }} onChange={onChange} onDelete={() => {}} />)

    const x = screen.getByLabelText('X') as HTMLInputElement
    const y = screen.getByLabelText('Y') as HTMLInputElement
    expect(x.value).toBe('300')
    expect(y.value).toBe('455')

    fireEvent.change(x, { target: { value: '312.5' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(x, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].geometry.segments.find((segment: { id: string }) => segment.id === 'a-1').waypoints.find((waypoint: { id: string }) => waypoint.id === 'w1').x).toBe(312.5)
  })

  it('restores invalid coordinate input instead of mutating the project', () => {
    const project = structuredClone(demoProject)
    const onChange = vi.fn()
    render(<StyleGeometryInspector project={project} selection={{ type: 'waypoint', id: 'w1', segmentId: 'a-1' }} onChange={onChange} onDelete={() => {}} />)

    const x = screen.getByLabelText('X') as HTMLInputElement
    fireEvent.change(x, { target: { value: '' } })
    fireEvent.blur(x)

    expect(onChange).not.toHaveBeenCalled()
    expect(x.value).toBe('300')
  })

  it('explains that style changes are made by selecting the target line section', () => {
    const project = structuredClone(demoProject)
    project.geometry.segments[0].structureNodes = [{ id: 'style-1', progress: .5, structureAfter: 'underground' }]
    render(<StyleGeometryInspector project={project} selection={{ type: 'structureNode', id: 'style-1', segmentId: 'a-1' }} onChange={() => {}} onDelete={() => {}} />)

    expect(screen.getByText(/要修改线路样式或结构，请直接选择需要修改的线路段/)).toBeTruthy()
  })
})
