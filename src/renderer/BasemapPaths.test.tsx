import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { exportSvg } from '../import-export/svgExport'
import { BasemapPathsLayer } from './BasemapPaths'

describe('BasemapPathsLayer', () => {
  it('renders filled and stroke-only paths in z order and exports them', () => {
    const project = createEmptyProject()
    project.basemapPaths = [
      { id: 'low', category: 'terrain', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 20 }], color: '#111111', width: 2, opacity: 1, closed: true, isFilled: true, zIndex: -1, visible: true, locked: false },
      { id: 'high', category: 'water', points: [{ id: 'd', x: 0, y: 0 }, { id: 'e', x: 40, y: 0 }], color: '#222222', width: 4, opacity: .5, closed: false, isFilled: false, zIndex: 2, visible: true, locked: false },
    ]
    const { container } = render(createElement('svg', { viewBox: '0 0 50 50' }, createElement(BasemapPathsLayer, { project })))
    const paths = [...container.querySelectorAll('[data-basemap-path-id] > path')]
    expect(paths).toHaveLength(2)
    expect(paths[0].getAttribute('fill')).toBe('#111111')
    expect(paths[0].getAttribute('d')).toContain('Z')
    expect(paths[1].getAttribute('fill')).toBe('none')
    expect(exportSvg(container.querySelector('svg')!, false)).toContain('data-basemap-path-id="low"')
  })

  it('renders imported filled AARC terrain as fill without a fallback stroke', () => {
    const project = createEmptyProject()
    project.basemapPaths = [{ id: 'aarc-fill', category: 'terrain', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 20 }, { id: 'd', x: 0, y: 0 }], color: '#CEEDA4', width: 125, opacity: 1, closed: true, isFilled: true, zIndex: 0, visible: true, locked: false, source: { format: 'aarc', sourceLineId: 46 } }]
    const { container } = render(createElement('svg', null, createElement(BasemapPathsLayer, { project })))
    const path = container.querySelector('[data-basemap-path-id="aarc-fill"] > path')!
    expect(path.getAttribute('fill')).toBe('#CEEDA4')
    expect(path.getAttribute('stroke')).toBe('none')
    expect(path.getAttribute('stroke-width')).toBe('0')
  })
})
