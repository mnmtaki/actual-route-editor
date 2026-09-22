import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { resolveAarcPointLinksArtwork } from '../import-export/aarcPointLinks'
import { exportSvg } from '../import-export/svgExport'
import { AarcPointLinksLayer } from './AarcPointLinks'
import { NetworkCanvas } from './NetworkCanvas'
import { compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'
import rawChangling from '../import-export/__fixtures__/常陵.aarc-9.json'
import rawPinglan from '../import-export/__fixtures__/平岚.aarc (9).json'
import { getPassengerStationCount } from '../data/passengerStats'

function source(type: number) {
  return {
    lines: [{ id: 10, name: '1号线', color: '#e33', width: 1, pts: [1, 2] }],
    points: [
      { id: 1, pos: [0, 0], sta: 1, name: '甲' },
      { id: 2, pos: [100, 0], sta: 1, name: '乙' },
    ],
    pointLinks: [{ pts: [1, 2], type }],
    cvsSize: [200, 100],
    config: { bgColor: '#fefefe', ptStaSize: 10, ptStaLineWidth: 4, ptStaFillColor: '#fafafa', ptStaExchangeLineColor: '#898989' },
  }
}

describe('AARC pointLinks visual renderer', () => {
  it.each([
    [0, 18, 14, 6, false],
    [1, 8, 4, undefined, false],
    [2, 8, 4, undefined, true],
    [3, 8, 4, undefined, true],
  ] as const)('renders source type %i with upstream widths and dash semantics', (type, carpet, body, core, dashed) => {
    const project = convertAarcToActualRouteProject(source(type), 'point-links.aarc.json').project
    const artwork = resolveAarcPointLinksArtwork(project)
    expect(artwork.links).toHaveLength(1)
    expect(artwork.links[0]).toMatchObject({ type, carpetWidth: carpet, bodyWidth: body })
    expect(artwork.links[0].coreWidth).toBe(core)
    expect(Boolean(artwork.links[0].dash)).toBe(dashed)
    const { container } = render(createElement('svg', null, createElement(AarcPointLinksLayer, { project })))
    const bodyPath = container.querySelector(`[data-aarc-point-link-type="${type}"][data-aarc-point-link-layer="body"]`)
    expect(bodyPath).toHaveAttribute('stroke', '#898989')
    expect(bodyPath).toHaveAttribute('stroke-width', String(body))
    expect(bodyPath?.hasAttribute('stroke-dasharray')).toBe(dashed)
  })

  it('uses raw source endpoints and never follows edited native station coordinates', () => {
    const project = convertAarcToActualRouteProject(source(1), 'point-links.aarc.json').project
    project.stations[0].x = 999
    project.stations[0].y = 777
    const link = resolveAarcPointLinksArtwork(project).links[0]
    expect(link.start).toEqual({ x: 0, y: 0 })
    expect(link.end).toEqual({ x: 100, y: 0 })
  })

  it('shrinks dot endpoints at station edges and distinguishes dotCover by endpoint covers', () => {
    const dot = convertAarcToActualRouteProject(source(2), 'dot.aarc.json').project
    const dotCover = convertAarcToActualRouteProject(source(3), 'dot-cover.aarc.json').project
    const dotArtwork = resolveAarcPointLinksArtwork(dot), coverArtwork = resolveAarcPointLinksArtwork(dotCover)
    expect(dotArtwork.links[0].start.x).toBe(16)
    expect(dotArtwork.links[0].end.x).toBe(84)
    expect(dotArtwork.covers).toHaveLength(0)
    expect(coverArtwork.links[0].start).toEqual(dotArtwork.links[0].start)
    expect(coverArtwork.links[0].end).toEqual(dotArtwork.links[0].end)
    expect(coverArtwork.covers.map(cover => cover.pointId)).toEqual([1, 2])
    const { container } = render(<svg><AarcPointLinksLayer project={dotCover} /></svg>)
    expect(container.querySelector('[data-aarc-point-link-cover-layer="carpet"]')).toHaveAttribute('r', '14')
    expect(container.querySelector('[data-aarc-point-link-cover-layer="body"]')).toHaveAttribute('r', '12')
    expect(container.querySelector('[data-aarc-point-link-cover-layer="core"]')).toHaveAttribute('r', '8')
  })

  it('excludes type 4 from the visual layer and preserves it as forced passenger compound semantics', () => {
    const raw = {
      lines: [
        { id: 10, name: '1号线', color: '#e33', width: 1, pts: [1, 2] },
        { id: 20, name: '2号线', color: '#36c', width: 1, pts: [3, 4] },
      ],
      points: [
        { id: 1, pos: [0, 0], sta: 1, name: '甲' }, { id: 2, pos: [100, 0], sta: 1, name: '乙' },
        { id: 3, pos: [200, 0], sta: 1, name: '丙' }, { id: 4, pos: [300, 0], sta: 1, name: '丁' },
      ],
      pointLinks: [{ pts: [1, 2], type: 0 }, { pts: [2, 3], type: 4 }],
      cvsSize: [400, 100], config: {},
    }
    const project = convertAarcToActualRouteProject(raw, 'mixed.aarc.json').project
    expect(resolveAarcPointLinksArtwork(project).links.map(link => link.type)).toEqual([0])
    expect(project.stationLineRelations).toHaveLength(4)
    expect(project.stations.find(station => station.source?.pointId === 1)?.compoundGroupId).toBeUndefined()
    const b = project.stations.find(station => station.source?.pointId === 2)
    const c = project.stations.find(station => station.source?.pointId === 3)
    expect(b?.compoundGroupId).toBeTruthy()
    expect(c?.compoundGroupId).toBe(b?.compoundGroupId)
  })

  it('keeps types 0-3 visual-only and preserves them in standalone SVG export', () => {
    for (const type of [0, 1, 2, 3]) {
      const project = convertAarcToActualRouteProject(source(type), `${type}.aarc.json`).project
      expect(project.stationLineRelations).toHaveLength(2)
      expect(getPassengerStationCount(project)).toBe(2)
      expect(project.stations.every(station => station.compoundGroupId === undefined)).toBe(true)
      const { container } = render(createElement('svg', null, createElement(AarcPointLinksLayer, { project })))
      const svg = exportSvg(container.querySelector('svg')!, false)
      expect(svg).toContain(`data-aarc-point-link-type="${type}"`)
    }
  })

  it('renders from the shared layer in Editor and Presentation between station bodies and labels', () => {
    const project = convertAarcToActualRouteProject(source(1), 'point-links.aarc.json').project
    const noop = () => {}
    const editor = render(<NetworkCanvas project={project} selection={null} drawing={null} onSelect={noop} onCreatePoint={noop} onConnectStation={noop} onExtend={noop} onSegmentPoint={noop} onPreview={noop} onDragCommit={noop} view={{ x: -50, y: -50, width: 200, height: 100 }} setView={noop} />)
    const editorSvg = editor.container.querySelector('svg')!
    const cameraViewport = editorSvg.querySelector('[data-layer="camera-viewport"]')!
    const editorLayers = [...cameraViewport.children].map(node => node.getAttribute('data-layer'))
    expect(editorLayers.indexOf('stations')).toBeLessThan(editorLayers.indexOf('aarc-point-links'))
    expect(editorLayers.indexOf('aarc-point-links')).toBeLessThan(editorLayers.indexOf('station-labels'))

    const sequence = compilePresentation(project)
    const presentation = render(<PresentationScene project={project} sequence={sequence} time={sequence.duration} width={800} height={500} />)
    const presentationSvg = presentation.container.querySelector('svg')!
    const presentationChildren = [...presentationSvg.children]
    const pointLinkIndex = presentationChildren.findIndex(node => node.getAttribute('data-layer') === 'aarc-point-links')
    expect(pointLinkIndex).toBeGreaterThan(presentationChildren.findIndex(node => node.getAttribute('data-presentation-layer') === 'stations'))
    expect(pointLinkIndex).toBeLessThan(presentationChildren.findIndex(node => node.getAttribute('data-presentation-layer') === 'station-labels'))
  })

  it('resolves current real fixtures without converting source types or endpoints', () => {
    const changling = resolveAarcPointLinksArtwork(convertAarcToActualRouteProject(rawChangling, '常陵.aarc-9.json').project)
    const pinglan = resolveAarcPointLinksArtwork(convertAarcToActualRouteProject(rawPinglan, '平岚.aarc (9).json').project)
    expect(changling.links.map(link => link.type)).toEqual([1])
    expect(pinglan.links.map(link => link.type)).toEqual([0, 0])
    expect([...changling.links, ...pinglan.links].every(link => [link.start.x, link.start.y, link.end.x, link.end.y].every(Number.isFinite))).toBe(true)
  })
})
