import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../data/storage'
import { AarcTextTagsLayer, resolveAarcDropCap, resolveAarcIconDimensions, resolveAarcTextTagParams } from './AarcTextTags'
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
    const text = container.querySelector('[data-aarc-text-render-kind="terrain"] text')
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
    const withCarpet = container.querySelector('[data-aarc-text-tag-id="with"] [data-aarc-text-render-kind="plain"] text')
    const withoutCarpet = container.querySelector('[data-aarc-text-tag-id="without"] [data-aarc-text-render-kind="plain"] text')
    expect(withCarpet?.getAttribute('stroke')).toBe('#fefefe')
    expect(withoutCarpet?.getAttribute('stroke')).toBeNull()
  })

  it('applies the AARC configVersion<1 line-tag compatibility defaults', () => {
    const project = createEmptyProject()
    project.aarc = { format: 'aarc', config: { configVersion: 0, textTagForLine: {} } }
    const tag = { id: 'legacy', kind: 'LineNameLabel' as const, x: 0, y: 0 }
    expect(resolveAarcTextTagParams(tag, project, 'line')).toMatchObject({ anchorX: 1, textAlign: 0 })
    project.aarc.config = { configVersion: 1, textTagForLine: {} }
    expect(resolveAarcTextTagParams(tag, project, 'line')).toMatchObject({ anchorX: 0, textAlign: 0 })
  })

  it('renders upstream dropCap as a real two-row composition', () => {
    const project = createEmptyProject()
    project.aarc = {
      format: 'aarc',
      config: { textTagForLineDropCap: true, textTagForLineDropCapDetect: 'classic' },
      raw: { lines: [{ id: 1, name: '12号线', nameSub: 'Metro 12', color: '#2255aa', pts: [] }] },
    }
    project.lines = [{ id: 'aarc-line-1', name: '12号线', nameSub: 'Metro 12', color: '#2255aa', stationSequence: [], lineOrder: 0, visible: true, locked: false, source: { format: 'aarc', sourceLineId: 1 } }]
    project.textTags = [{ id: 'drop', kind: 'LineNameLabel', x: 100, y: 100, lineId: 'aarc-line-1', source: { format: 'aarc', kind: 'text-tag', forId: 1, targetKind: 'line' } }]
    const { container } = render(createElement(AarcTextTagsLayer, { project }))
    const drop = container.querySelector('[data-aarc-text-render-kind="line-dropcap"]')
    expect(resolveAarcDropCap({ ...project.textTags[0], dropCap: true }, '12号线', 'Metro 12')).toBe('12')
    expect(drop?.getAttribute('data-aarc-dropcap-part')).toBe('12')
    expect(drop?.querySelectorAll('text')).toHaveLength(3)
    expect(drop?.textContent).toContain('12')
    expect(drop?.textContent).toContain('号线')
    expect(drop?.textContent).toContain('Metro 12')
  })

  it('matches AARC line-label carpet geometry from source padding instead of an invented radius', () => {
    const project = createEmptyProject()
    project.aarc = {
      format: 'aarc',
      config: { lineWidth: 16, textTagForLine: { padding: 1.5 } },
      raw: { lines: [{ id: 1, name: 'R', color: '#2255aa', pts: [] }] },
    }
    project.lines = [{ id: 'aarc-line-1', name: 'R', color: '#2255aa', stationSequence: [], lineOrder: 0, visible: true, locked: false, source: { format: 'aarc', sourceLineId: 1 } }]
    project.textTags = [{ id: 'source-carpet', kind: 'LineNameLabel', x: 0, y: 0, padding: 0, lineId: 'aarc-line-1', source: { format: 'aarc', kind: 'text-tag', forId: 1, targetKind: 'line' } }]
    const { container, rerender } = render(createElement(AarcTextTagsLayer, { project }))
    let carpet = container.querySelector('[data-aarc-line-name-carpet="true"]')
    expect(carpet).toHaveAttribute('stroke-width', '24')
    expect(carpet).toHaveAttribute('stroke-linejoin', 'round')
    expect(carpet).not.toHaveAttribute('rx')
    expect(carpet).not.toHaveAttribute('ry')

    const updated = structuredClone(project)
    updated.textTags![0].padding = 2
    rerender(createElement(AarcTextTagsLayer, { project: updated }))
    carpet = container.querySelector('[data-aarc-line-name-carpet="true"]')
    expect(carpet).toHaveAttribute('stroke-width', '32')
  })

  it('treats width as a minimum background width without wrapping text', () => {
    const project = createEmptyProject()
    project.aarc = { format: 'aarc', raw: { lines: [{ id: 1, name: 'R', color: '#2255aa', pts: [] }] } }
    project.lines = [{ id: 'aarc-line-1', name: 'R', color: '#2255aa', stationSequence: [], lineOrder: 0, visible: true, locked: false, source: { format: 'aarc', sourceLineId: 1 } }]
    project.textTags = [{ id: 'wide', kind: 'LineNameLabel', x: 0, y: 0, width: 200, lineId: 'aarc-line-1', source: { format: 'aarc', kind: 'text-tag', forId: 1, targetKind: 'line' } }]
    const { container } = render(createElement(AarcTextTagsLayer, { project }))
    const rect = container.querySelector('[data-aarc-line-name-carpet="true"]')
    expect(rect?.getAttribute('width')).toBe('200')
    expect(rect?.getAttribute('data-aarc-width-mode')).toBe('minimum')
    expect(container.querySelectorAll('[data-aarc-text-tag-id="wide"] text')).toHaveLength(1)
  })

  it('filters sunken line tags by presentation-visible line ids', () => {
    const project = createEmptyProject()
    project.lines = [{ id: 'line-a', name: 'A', color: '#123456', stationSequence: [], lineOrder: 0, visible: true, locked: false }]
    project.textTags = [{ id: 'sunken-line', kind: 'LineNameLabel', x: 0, y: 0, lineId: 'line-a', sunken: true }]
    const hidden = render(createElement(VectorBasemapLayer, { project, presentation: true, visibleLineIds: new Set<string>() }))
    expect(hidden.container.querySelector('[data-aarc-text-tag-id="sunken-line"]')).toBeNull()
    hidden.unmount()
    const visible = render(createElement(VectorBasemapLayer, { project, presentation: true, visibleLineIds: new Set(['line-a']) }))
    expect(visible.container.querySelector('[data-aarc-text-tag-id="sunken-line"]')).not.toBeNull()
  })
})
