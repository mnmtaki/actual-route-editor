import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AarcLineStyle } from '../data/model'
import { resolveLineStyle } from '../data/lineStyles'
import { SegmentArtwork } from '../renderer/segmentStyles'
import { convertAarcToActualRouteProject } from './aarc'
import { parseProjectJson, serializeProject } from './projectJson'
import realSample from './__fixtures__/木阳.aarc.json'

const styles: AarcLineStyle[] = [
  { id: '10', name: 'Style 1', layers: [{ color: '#ff0000', colorMode: 'fixed', width: .5, opacity: .7, dash: '2 1', cap: 'butt', join: 'round' }] },
  { id: '11', name: 'Style 2', noBase: true, layers: [{ color: '#0000ff', colorMode: 'fixed', width: .25 }, { colorMode: 'line', width: .5 }] },
]

function syntheticAarc(styleSlices: Array<Record<string, unknown>> = [], child = false) {
  const points = [1, 2, 3, 4, 5].map((id) => ({ id, pos: [id * 100, 0], sta: 1, dir: 0, name: String.fromCharCode(64 + id) }))
  const parent = { id: 1, name: 'L', color: '#00aa00', width: 1, style: 10, pts: [1, 2, 3, 4, 5] }
  const childLine = { id: 2, name: 'Child', color: '#aa00aa', width: 1, style: -1, parent: 1, pts: [1, 2, 3] }
  return { cvsSize: [1000, 1000], config: { lineWidth: 10, lineWidthMapped: {} }, points, lines: child ? [parent, childLine] : [parent], lineStyles: styles, styleSlices }
}

describe('AARC lineStyles and styleSlices shared integration', () => {
  it('imports Line styles into the shared style registry and reverses AARC paint order', () => {
    const project = convertAarcToActualRouteProject(syntheticAarc()).project
    const style = project.styles?.find(item => item.id === '11')
    expect(style).toMatchObject({ hideBaseLine: true })
    expect(style?.layers.map(layer => layer.colorMode)).toEqual(['followLine', 'custom'])
    expect(style?.layers[0].width).toBe(.5)
  })

  it('maps a covering AARC styleSlice to each ActualRoute Segment without changing geometry', () => {
    const project = convertAarcToActualRouteProject(syntheticAarc([{ id: 20, line: 1, fromPt: 2, toPt: 4, style: 11 }])).project
    expect(project.geometry.segments.map(segment => segment.lineStyleId)).toEqual([undefined, '11', '11', undefined])
    expect(project.geometry.segments.map(segment => segment.fromStationId + '-' + segment.toStationId)).toEqual([
      'aarc-station-1-aarc-station-2', 'aarc-station-2-aarc-station-3', 'aarc-station-3-aarc-station-4', 'aarc-station-4-aarc-station-5',
    ])
  })

  it('keeps style=0 as an explicit base-line-only override and style=-1 as Line inheritance', () => {
    const noStyle = convertAarcToActualRouteProject(syntheticAarc([{ id: 21, line: 1, fromPt: 2, toPt: 3, style: 0 }])).project
    expect(noStyle.geometry.segments[1].lineStyleId).toBeNull()
    const inherited = convertAarcToActualRouteProject(syntheticAarc([{ id: 22, line: 1, fromPt: 2, toPt: 3, style: -1 }])).project
    expect(inherited.geometry.segments[1].lineStyleId).toBeUndefined()
    const child = convertAarcToActualRouteProject(syntheticAarc([{ id: 23, line: 2, fromPt: 1, toPt: 3, style: -1 }], true)).project
    expect(child.lines.find(line => line.id === 'aarc-line-2')?.lineStyleId).toBe('10')
    expect(child.geometry.segments.filter(segment => segment.lineId === 'aarc-line-2').every(segment => segment.lineStyleId === undefined)).toBe(true)
  })

  it('renders noBase=false as base plus layers and noBase=true as layers only', () => {
    const project = convertAarcToActualRouteProject(syntheticAarc([{ id: 20, line: 1, fromPt: 2, toPt: 4, style: 11 }])).project
    const line = project.lines[0], first = project.geometry.segments[0], styled = project.geometry.segments[1]
    const firstView = render(<svg><SegmentArtwork segment={first} line={line} path="M 0 0 L 100 0" lineWidth={10} renderLegacyStructure={false} style={resolveLineStyle(project, line, first)} /></svg>)
    expect(firstView.container.querySelectorAll('path')).toHaveLength(2)
    expect(firstView.container.querySelector('[data-line-style-base="true"]')).toBeTruthy()
    const firstLayer = firstView.container.querySelector('[data-line-style-layer]')!
    expect(firstLayer).toHaveAttribute('stroke', '#ff0000')
    expect(firstLayer).toHaveAttribute('stroke-width', '5')
    expect(firstLayer).toHaveAttribute('stroke-dasharray', '20 10')
    expect(firstLayer).toHaveAttribute('stroke-opacity', '0.7')
    expect(firstLayer).toHaveAttribute('stroke-linecap', 'butt')

    const styledView = render(<svg><SegmentArtwork segment={styled} line={line} path="M 0 0 L 100 0" lineWidth={10} renderLegacyStructure={false} style={resolveLineStyle(project, line, styled)} /></svg>)
    const layers = [...styledView.container.querySelectorAll('[data-line-style-layer]')]
    expect(styledView.container.querySelector('[data-line-style-base="true"]')).toBeNull()
    expect(layers).toHaveLength(2)
    expect(layers[0]).toHaveAttribute('stroke', line.color)
    expect(layers[1]).toHaveAttribute('stroke', '#0000ff')
  })

  it('round-trips Segment overrides and imported styles through native JSON', () => {
    const original = convertAarcToActualRouteProject(syntheticAarc([{ id: 20, line: 1, fromPt: 2, toPt: 4, style: 11 }, { id: 21, line: 1, fromPt: 4, toPt: 5, style: 0 }])).project
    const restored = parseProjectJson(serializeProject(original))
    expect(restored.styles).toEqual(original.styles)
    expect(restored.geometry.segments.map(segment => segment.lineStyleId)).toEqual(original.geometry.segments.map(segment => segment.lineStyleId))
    expect(restored.aarc?.styleSlices).toEqual(original.aarc?.styleSlices)
  })

  it('imports the real 木阳 style registry without changing its existing rail structure', () => {
    const result = convertAarcToActualRouteProject(realSample, '木阳.aarc.json')
    expect(result.project.styles?.map(style => style.id)).toEqual(expect.arrayContaining(['1', '2', '147']))
    expect(result.project.geometry.segments).toHaveLength(105)
    expect(result.project.lines.map(line => line.name)).toEqual(['1', '3', '4', '6'])
  })
})
