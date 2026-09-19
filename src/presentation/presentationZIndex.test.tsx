import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { compilePresentation } from './compiler'
import { PresentationScene } from './PresentationScene'

const source = (lineId: number, sourceZIndex: number) => ({
  format: 'aarc' as const,
  lineId,
  sourceLineId: lineId,
  sourceZIndex,
})

describe('AARC zIndex in presentation', () => {
  it('renders visible segment groups in AARC zIndex order', () => {
    const project = structuredClone(demoProject)
    project.lines[0].source = source(1, 10)
    project.lines[1].source = source(2, -5)
    project.lines[2].source = source(3, 0)
    const sequence = compilePresentation(project)
    const { container } = render(<PresentationScene project={project} sequence={sequence} time={sequence.duration} width={1920} height={1080} />)
    const layer = container.querySelector('[data-presentation-layer="segments"]')!
    const ids = [...layer.children].flatMap(group => [...group.querySelectorAll('[data-segment-id]')].map(node => node.getAttribute('data-segment-id')))
    expect(ids).toEqual(['b-1', 'b-2', 'c-1', 'c-2', 'a-1', 'a-2', 'a-3'])
  })
})
