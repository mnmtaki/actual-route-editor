import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { RoadsLayer } from './Roads'

describe('RoadsLayer', () => {
  it('renders every style layer and omits hidden roads', () => {
    const project = createEmptyProject()
    project.roads = [{ id: 'road-1', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 50 }], styleId: 'road-express', zIndex: 0, visible: true, locked: false, createdOrder: 0 }, { id: 'hidden', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }], styleId: 'road-local', zIndex: 0, visible: false, locked: false, createdOrder: 1 }]
    const { container } = render(<svg><RoadsLayer project={project} /></svg>)
    expect(container.querySelectorAll('[data-road-id="road-1"] [data-road-layer]')).toHaveLength(2)
    expect(container.querySelector('[data-road-id="hidden"]')).toBeNull()
  })
  it('does not render editor handles in presentation mode', () => {
    const project = createEmptyProject(); project.roads = [{ id: 'road-1', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 50 }], styleId: 'road-local', zIndex: 0, visible: true, locked: false, createdOrder: 0 }]
    const { container } = render(<svg><RoadsLayer project={project} presentation /></svg>)
    expect(container.querySelector('[data-editor]')).toBeNull()
  })
})
