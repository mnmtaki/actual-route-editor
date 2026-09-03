import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { VectorBasemapLayer } from './VectorBasemap'

describe('VectorBasemapLayer', () => {
  it('interleaves roads and basemap paths by zIndex', () => {
    const project = createEmptyProject()
    project.basemapPaths = [{ id: 'terrain', category: 'terrain', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }], color: '#b8c89b', width: 3, opacity: 1, closed: false, isFilled: false, zIndex: 2, visible: true, locked: false }]
    project.roads = [{ id: 'road', points: [{ id: 'a', x: 0, y: 5 }, { id: 'b', x: 20, y: 5 }], styleId: 'road-local', zIndex: 1, visible: true, locked: false, createdOrder: 0 }]
    const { container } = render(<svg><VectorBasemapLayer project={project} /></svg>), layer = container.querySelector('[data-layer="vector-basemap"]')!
    expect([...layer.children].map(node => node.getAttribute('data-road-id') ?? node.getAttribute('data-basemap-path-id'))).toEqual(['road', 'terrain'])
  })
})
