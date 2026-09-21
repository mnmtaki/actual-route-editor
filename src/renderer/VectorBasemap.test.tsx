import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { VectorBasemapLayer } from './VectorBasemap'

describe('VectorBasemapLayer', () => {
  it('can exclude one static road and render only that road in an active overlay', () => {
    const project = createEmptyProject()
    project.roads = [
      { id: 'road-a', points: [{ id: 'a1', x: 0, y: 0 }, { id: 'a2', x: 20, y: 0 }], styleId: 'road-local', zIndex: 0, visible: true, locked: false, createdOrder: 0 },
      { id: 'road-b', points: [{ id: 'b1', x: 0, y: 10 }, { id: 'b2', x: 20, y: 10 }], styleId: 'road-local', zIndex: 1, visible: true, locked: false, createdOrder: 1 },
    ]
    const excluded = new Set(['road-a'])
    const base = render(<svg><VectorBasemapLayer project={project} excludeObjectIds={excluded} /></svg>)
    expect(base.container.querySelector('[data-road-id="road-a"]')).toBeNull()
    expect(base.container.querySelector('[data-road-id="road-b"]')).not.toBeNull()
    const overlay = render(<svg><VectorBasemapLayer project={project} includeObjectIds={excluded} overlay /></svg>)
    expect(overlay.container.querySelector('[data-layer="vector-basemap-active-overlay"] [data-road-id="road-a"]')).not.toBeNull()
    expect(overlay.container.querySelector('[data-road-id="road-b"]')).toBeNull()
    expect(overlay.container.querySelector('[data-aarc-terrain-transitions]')).toBeNull()
  })

  it('interleaves roads and basemap paths by zIndex', () => {
    const project = createEmptyProject()
    project.basemapPaths = [{ id: 'terrain', category: 'terrain', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }], color: '#b8c89b', width: 3, opacity: 1, closed: false, isFilled: false, zIndex: 2, visible: true, locked: false }]
    project.roads = [{ id: 'road', points: [{ id: 'a', x: 0, y: 5 }, { id: 'b', x: 20, y: 5 }], styleId: 'road-local', zIndex: 1, visible: true, locked: false, createdOrder: 0 }]
    const { container } = render(<svg><VectorBasemapLayer project={project} /></svg>), layer = container.querySelector('[data-layer="vector-basemap"]')!
    expect([...layer.children].map(node => node.getAttribute('data-road-id') ?? node.getAttribute('data-basemap-path-id'))).toEqual(['road', 'terrain'])
  })
})
