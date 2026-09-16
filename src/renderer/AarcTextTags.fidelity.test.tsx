import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { AarcTextTagsLayer, resolveAarcIconDimensions } from './AarcTextTags'
import { VectorBasemapLayer } from './VectorBasemap'

describe('AARC TextTag fidelity', () => {
  it('renders sunken tags instead of dropping them', () => {
    const project = createEmptyProject()
    project.textTags = [{ id: 'sunken', kind: 'FreeMapText', x: 10, y: 20, text: '下沉标签', sunken: true }]
    const { container } = render(createElement(VectorBasemapLayer, { project }))
    const layer = container.querySelector('[data-layer="aarc-text-tags-sunken"]')
    expect(layer).not.toBeNull()
    expect(layer?.querySelector('[data-aarc-text-tag-id="sunken"]')?.textContent).toContain('下沉标签')
    expect(container.querySelector('[data-layer="aarc-text-tags"]')).toBeNull()
  })

  it('keeps normal and sunken tags in separate layers', () => {
    const project = createEmptyProject()
    project.textTags = [
      { id: 'below', kind: 'FreeMapText', x: 0, y: 0, text: 'below', sunken: true },
      { id: 'above', kind: 'FreeMapText', x: 0, y: 0, text: 'above' },
    ]
    const { container: low } = render(createElement(AarcTextTagsLayer, { project, mode: 'sunken' }))
    expect(low.querySelector('[data-aarc-text-tag-id="below"]')).not.toBeNull()
    expect(low.querySelector('[data-aarc-text-tag-id="above"]')).toBeNull()
    const { container: high } = render(createElement(AarcTextTagsLayer, { project }))
    expect(high.querySelector('[data-aarc-text-tag-id="below"]')).toBeNull()
    expect(high.querySelector('[data-aarc-text-tag-id="above"]')).not.toBeNull()
  })

  it('renders terrain-bound tags with terrain styling', () => {
    const project = createEmptyProject()
    project.aarc = {
      format: 'aarc',
      raw: { lines: [{ id: 90, type: 1, name: '河流', color: '#336699', pts: [1, 2] }] },
    }
    project.basemapPaths = [{ id: 'terrain', name: '河流', category: 'water', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }], color: '#336699', width: 14, opacity: 1, closed: false, isFilled: false, zIndex: 0, visible: true, locked: false, source: { format: 'aarc', sourceLineId: 90 } }]
    project.textTags = [{ id: 'terrain-tag', kind: 'TerrainNameLabel', x: 10, y: 10, source: { format: 'aarc', kind: 'text-tag', forId: 90, targetKind: 'terrain' } }]
    const { container } = render(createElement(AarcTextTagsLayer, { project }))
    const text = container.querySelector('[data-aarc-text-render-kind="terrain"]')
    expect(text).not.toBeNull()
    expect(text?.getAttribute('stroke')).toBe('#336699')
    expect(text?.textContent).toContain('河流')
  })

  it('uses natural aspect ratio for non-square icons', () => {
    expect(resolveAarcIconDimensions({ id: 'wide', width: 60 }, 2)).toEqual({ width: 60, height: 30 })
    expect(resolveAarcIconDimensions({ id: 'tall', width: 40 }, .5)).toEqual({ width: 40, height: 80 })
  })

  it('removes the plain text carpet only when removeCarpet is true', () => {
    const project = createEmptyProject()
    project.aarc = { format: 'aarc', config: { bgColor: '#fefefe' } }
    project.textTags = [
      { id: 'with', kind: 'FreeMapText', x: 0, y: 0, text: '描边' },
      { id: 'without', kind: 'FreeMapText', x: 0, y: 40, text: '无描边', removeCarpet: true },
    ]
    const { container } = render(createElement(AarcTextTagsLayer, { project }))
    const withCarpet = container.querySelector('[data-aarc-text-tag-id="with"] [data-aarc-text-render-kind="plain"]')
    const withoutCarpet = container.querySelector('[data-aarc-text-tag-id="without"] [data-aarc-text-render-kind="plain"]')
    expect(withCarpet?.getAttribute('stroke')).toBe('#fefefe')
    expect(withoutCarpet?.getAttribute('stroke')).toBeNull()
  })
})
