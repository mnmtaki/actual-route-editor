import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { createDefaultStationStyle } from '../data/stationStyles'
import { getBuiltInStationStyle } from '../data/presetRegistry'
import { exportSvg } from '../import-export/svgExport'
import { StationMarker } from './StationMarker'
import { getStationStyle, renderStationArtwork } from './stationStyles'

const station = { ...demoProject.stations[0], id: 'artwork-test', x: 100, y: 80 }
const style = () => createDefaultStationStyle(11)

describe('shared ordinary StationArtwork', () => {
  it.each([
    ['circle', 'circle'],
    ['square', 'rect'],
    ['roundedRect', 'rect'],
    ['capsule', 'rect'],
    ['diamond', 'path'],
  ] as const)('renders the %s shape through the shared artwork', (shape, tag) => {
    const current = style()
    current.shape = shape
    current.width = shape === 'circle' ? 18 : 18
    current.height = shape === 'circle' ? 18 : 12
    current.lockAspect = false
    const { container } = render(<svg>{renderStationArtwork({ station, style: current })}</svg>)
    const node = container.querySelector(`[data-station-shape="${shape}"]`)
    expect(node?.tagName.toLowerCase()).toBe(tag)
  })

  it('applies dimensions, rotation, fill, stroke and halo to one shape', () => {
    const current = style()
    current.shape = 'roundedRect'
    current.width = 20
    current.height = 14
    current.lockAspect = false
    current.cornerRadius = 4
    current.rotation = 30
    current.fillColor = '#123456'
    current.fillOpacity = .7
    current.strokeEnabled = true
    current.strokeColorMode = 'fixed'
    current.strokeColor = '#654321'
    current.strokeWidth = 2
    current.strokeOpacity = .8
    current.haloEnabled = true
    current.haloColor = '#abcdef'
    current.haloWidth = 3
    current.haloGap = 2
    const { container } = render(<svg>{renderStationArtwork({ station, style: current })}</svg>)
    const group = container.querySelector('[data-station-artwork="artwork-test"]')!
    const body = container.querySelector('[data-station-shape="roundedRect"]:not([data-station-shape$="halo"])')!
    expect(group).toHaveAttribute('transform', 'rotate(30 100 80)')
    expect(body).toHaveAttribute('x', '90')
    expect(body).toHaveAttribute('y', '73')
    expect(body).toHaveAttribute('width', '20')
    expect(body).toHaveAttribute('height', '14')
    expect(body).toHaveAttribute('fill', '#123456')
    expect(body).toHaveAttribute('fill-opacity', '0.7')
    expect(body).toHaveAttribute('stroke', '#654321')
    expect(body).toHaveAttribute('stroke-width', '2')
    expect(container.querySelector('[data-station-shape="roundedRect-halo"]')).toHaveAttribute('stroke', '#abcdef')
  })

  it('supports disabled fill and none stroke without restoring a fallback stroke', () => {
    const current = style()
    current.fillEnabled = false
    current.strokeEnabled = true
    current.strokeColorMode = 'none'
    current.strokeWidth = 5
    const { container } = render(<svg>{renderStationArtwork({ station, style: current })}</svg>)
    const body = container.querySelector('[data-station-shape="circle"]')!
    expect(body).toHaveAttribute('fill', 'none')
    expect(body).toHaveAttribute('stroke', 'none')
    expect(body).toHaveAttribute('stroke-width', '0')
  })

  it('uses a custom style for an ordinary station while transfer artwork stays unchanged', () => {
    const project = structuredClone(demoProject)
    const custom = style()
    custom.id = 'custom-square'
    custom.name = '方形重点站'
    custom.shape = 'square'
    custom.width = 20
    custom.height = 12
    custom.lockAspect = false
    delete custom.builtin
    project.stationStyles = [createDefaultStationStyle(project.settings.stationSize), custom]
    project.stations[0].stationStyleId = custom.id
    const ordinary = render(<svg><StationMarker project={project} station={project.stations[0]} time="2005-01-01" selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
    expect(ordinary.container.querySelector('[data-station-style-id="custom-square"]')).toBeTruthy()
    expect(ordinary.container.querySelector('[data-station-shape="square"]')).toHaveAttribute('width', '20')
    ordinary.unmount()
    const transfer = render(<svg><StationMarker project={project} station={project.stations[1]} time="2015-01-01" selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
    expect(transfer.getByTestId('transfer-s2')).toBeTruthy()
    expect(transfer.getByTestId('transfer-s2').querySelector('rect')).toHaveAttribute('height', String(project.settings.transferMinorAxis))
  })

  it('passes the same ordinary artwork through presentation and SVG serialization', () => {
    const current = style()
    current.shape = 'diamond'
    current.width = 16
    current.height = 16
    const { container } = render(<svg>{getStationStyle('default').renderPresentation({ station, previousLines: [], lines: [], size: 11, minorAxis: 19.5, dotGap: 2.25, endPadding: 5.15, rotation: 0, morphProgress: 0, opacity: 1, scale: 1, ordinaryStyle: current })}</svg>)
    expect(container.querySelector('[data-station-shape="diamond"]')).toBeTruthy()
    expect(exportSvg(container.querySelector('svg')!, true)).toContain('data-station-shape="diamond"')
  })

  it('renders built-in Shanghai side markers and Guangzhou number pills through the shared artwork', () => {
    const shanghai = getBuiltInStationStyle('station.shanghai.basic')!
    const side = render(<svg>{renderStationArtwork({ station, style: shanghai, lineColor: '#d34b44', centerX: 116, centerY: 64 })}</svg>)
    expect(side.container.querySelector('[data-station-style-id="station.shanghai.basic"]')).toBeTruthy()
    expect(side.container.querySelector('[data-station-shape="square"]')).toHaveAttribute('fill', '#d34b44')
    expect(side.container.querySelector('[data-station-shape="square"]')).toHaveAttribute('x', '107')
    side.unmount()
    const guangzhou = getBuiltInStationStyle('station.guangzhou.basic')!
    const pill = render(<svg>{renderStationArtwork({ station, style: guangzhou, lineColor: '#d34b44', lineCode: '1', stationCode: '01' })}</svg>)
    expect(pill.container.querySelector('[data-station-shape="capsule"]')).toBeTruthy()
    expect(pill.container.querySelector('.station-number-pill-label')).toHaveTextContent('1 | 01')
  })
})
