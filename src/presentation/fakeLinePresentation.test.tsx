import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { materializeAarcFakeLineEntries } from '../data/aarcFakeLineEntries'
import { compilePresentation } from './compiler'
import { PresentationScene } from './PresentationScene'

describe('AARC fake common line presentation order', () => {
  it('interleaves a fake common line with real AARC lines by zIndex and keeps its TextTag visible', () => {
    const seed = structuredClone(demoProject)
    seed.lines[0].source = { format: 'aarc', lineId: 1, sourceLineId: 1, sourceZIndex: 10 }
    seed.lines[1].source = { format: 'aarc', lineId: 2, sourceLineId: 2, sourceZIndex: 0 }
    seed.lines[2].source = { format: 'aarc', lineId: 3, sourceLineId: 3, sourceZIndex: 20 }
    seed.aarc = {
      format: 'aarc',
      config: { lineWidth: 14, lineCarpetWiden: 7, lineTurnAreaRadius: 30 },
      raw: {
        lines: [
          { id: 1, type: 0, zIndex: 10, pts: [] },
          { id: 2, type: 0, zIndex: 0, pts: [] },
          { id: 3, type: 0, zIndex: 20, pts: [] },
          { id: 4, type: 0, zIndex: 5, isFake: true, name: '图例线', color: '#445566', pts: [101, 102] },
        ],
        points: [
          { id: 101, pos: [260, 260], dir: 0, sta: 0 },
          { id: 102, pos: [520, 260], dir: 0, sta: 0 },
        ],
      },
    }
    seed.textTags = [{
      id: 'fake-tag', kind: 'FreeMapText', x: 360, y: 220,
      source: { format: 'aarc', kind: 'text-tag', textTagId: 1, forId: 4, raw: { forId: 4 } },
      raw: { forId: 4 },
    }]
    const project = materializeAarcFakeLineEntries(seed)
    const sequence = compilePresentation(project)
    const { container } = render(<PresentationScene project={project} sequence={sequence} time={sequence.duration} width={1920} height={1080} />)
    const layer = container.querySelector('[data-presentation-layer="segments"]')!
    const order = [...layer.children].map(node => {
      if (node.querySelector('[data-aarc-fake-line-id="4"]')) return 'fake'
      return node.querySelector('[data-segment-id]')?.getAttribute('data-segment-id') ?? ''
    }).filter(Boolean)
    expect(order.indexOf('b-1')).toBeLessThan(order.indexOf('fake'))
    expect(order.indexOf('fake')).toBeLessThan(order.indexOf('a-1'))
    expect(container.querySelector('[data-aarc-text-tag-id="fake-tag"]')).toHaveAttribute('data-aarc-text-tag-render-mode', 'line')
    expect(container.textContent).toContain('图例线')
  })
})
