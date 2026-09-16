import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { StyleGeometryInspector } from './StyleGeometryInspector'

describe('segment geometry mode options', () => {
  it('offers only polyline, smooth curve and rounded polyline', () => {
    const project = structuredClone(demoProject)
    render(<StyleGeometryInspector project={project} selection={{ type: 'segment', id: project.geometry.segments[0].id }} onChange={() => {}} onDelete={() => {}} />)
    const select = screen.getByLabelText('绘制模式') as HTMLSelectElement
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['straight', '折线'],
      ['smooth', '平滑曲线'],
      ['rounded', '圆角折线'],
    ])
  })
})
