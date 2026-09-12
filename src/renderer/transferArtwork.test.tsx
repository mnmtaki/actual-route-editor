import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { getBuiltInTransferStyle } from '../data/presetRegistry'
import { collapseLinesByServiceFamily, lineWithEffectiveColor } from '../data/lineIdentity'
import { sortTransferLinesForSpatialOrder } from '../geometry/transferOrdering'
import { getDefaultTransferMetrics } from './stationStyles'
import { renderTransferArtwork } from './transferArtwork'

function sample(count: number) {
  const project = structuredClone(demoProject)
  const station = project.stations[1]
  const lines = Array.from({ length: count }, (_, index) => project.lines[index] ?? { ...project.lines[index % project.lines.length], id: `synthetic-line-${index}`, name: `${index + 1}号线`, lineOrder: index })
  project.lines = [...project.lines.filter(line => lines.some(item => item.id === line.id)), ...lines.filter(line => !project.lines.some(item => item.id === line.id))]
  project.stationLineRelations = lines.map((line, index) => ({ id: `preview-r-${index}`, stationId: station.id, lineId: line.id, stationCode: `0${index + 1}`, openedAt: '2000-01-01' }))
  return { project, station, lines: sortTransferLinesForSpatialOrder(project, station.id, collapseLinesByServiceFamily(project, lines.map(line => lineWithEffectiveColor(project, line))), '2025-01-01') }
}

const props = (count: number, styleId: string) => { const value = sample(count), style = getBuiltInTransferStyle(styleId)!; return { ...value, style } }

function spatialProps(count: number, orientation: 'horizontal' | 'vertical' | 'radial' = 'radial') {
  const value = sample(count)
  const angles = orientation === 'horizontal'
    ? [Math.PI, 0]
    : orientation === 'vertical'
      ? [-Math.PI / 2, Math.PI / 2]
      : Array.from({ length: count }, (_, index) => -Math.PI / 2 + index * 2 * Math.PI / Math.max(1, count))
  value.project.stationLineRelations.forEach((relation, index) => {
    const angle = angles[index] ?? angles[index % angles.length]
    relation.anchor = { x: value.station.x + Math.cos(angle) * 60, y: value.station.y + Math.sin(angle) * 60 }
  })
  return { ...value, style: getBuiltInTransferStyle('transfer.guangzhou.2024')! }
}

function pillPositions(container: HTMLElement) {
  return [...container.querySelectorAll<SVGGElement>('[data-transfer-cell="true"]')].map(cell => ({
    x: Number(cell.getAttribute('data-guangzhou-pill-position-x')),
    y: Number(cell.getAttribute('data-guangzhou-pill-position-y')),
    rect: cell.querySelector('[data-guangzhou-pill-background="true"]') as SVGRectElement,
    lineId: cell.getAttribute('data-line-id'),
  }))
}

describe('shared TransferArtwork preset templates', () => {
  it('keeps ActualRoute default dots and supports Shanghai white adaptive capsules without dots', () => {
    const actual = props(2, 'transfer.actualroute.default'), actualView = render(<svg>{renderTransferArtwork({ project: actual.project, station: actual.station, lines: actual.lines, style: actual.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    expect(actualView.container.querySelectorAll('[data-transfer-dot="true"]')).toHaveLength(2)
    actualView.unmount()
    const shanghai = props(3, 'transfer.shanghai.default'), view = render(<svg>{renderTransferArtwork({ project: shanghai.project, station: shanghai.station, lines: shanghai.lines, style: shanghai.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8, minMajorAxis: 80 })}</svg>)
    expect(view.container.querySelector('[data-transfer-template="shanghai"]')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-transfer-dot="true"]')).toHaveLength(0)
    expect(Number(view.container.querySelector('rect')?.getAttribute('width'))).toBeGreaterThanOrEqual(80)
  })

  it('renders Guangzhou classic 2/3/4 layouts and marks five services incompatible', () => {
    for (const count of [2, 3, 4]) {
      const value = props(count, 'transfer.guangzhou.classic'), view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      expect(view.container.querySelectorAll('[data-transfer-cell="true"]')).toHaveLength(count)
      expect(view.container.querySelectorAll('[data-transfer-arrow="true"]')).toHaveLength(count)
      expect(view.container.querySelectorAll('[data-guangzhou-pill="true"]')).toHaveLength(count)
      expect(view.container.querySelectorAll('[data-guangzhou-pill-background="true"]')).toHaveLength(count)
      expect([...view.container.querySelectorAll('[data-guangzhou-pill-background="true"]')].every(node => node.getAttribute('fill') === 'white')).toBe(true)
      expect([...view.container.querySelectorAll('[data-guangzhou-pill-line="true"], [data-guangzhou-pill-station="true"]')].every(node => node.getAttribute('fill') === '#202526')).toBe(true)
      expect([...view.container.querySelectorAll('[data-guangzhou-arrow] path')].some(node => node.getAttribute('d')?.includes('Q'))).toBe(true)
      view.unmount()
    }
    const incompatible = props(5, 'transfer.guangzhou.classic'), view = render(<svg>{renderTransferArtwork({ project: incompatible.project, station: incompatible.station, lines: incompatible.lines, style: incompatible.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    expect(view.container.querySelector('[data-transfer-incompatible="true"]')).toBeTruthy()
  })

  it('keeps Guangzhou 2024 cell count equal to service count for 2–6 lines', () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const value = props(count, 'transfer.guangzhou.2024'), view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      expect(view.container.querySelectorAll('[data-transfer-cell="true"]')).toHaveLength(count)
      expect(view.container.querySelectorAll('[data-guangzhou-pill="true"]')).toHaveLength(count)
      expect(view.container.querySelector('[data-guangzhou-shell="true"]')).toBeTruthy()
      expect(view.container.querySelectorAll('[data-transfer-arrow="true"]')).toHaveLength(0)
      view.unmount()
    }
  })

  it('uses spatial anchors for horizontal and vertical Guangzhou 2024 pairs', () => {
    const horizontal = spatialProps(2, 'horizontal'), horizontalView = render(<svg>{renderTransferArtwork({ project: horizontal.project, station: horizontal.station, lines: horizontal.lines, style: horizontal.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    const horizontalPositions = pillPositions(horizontalView.container)
    expect(Math.abs(horizontalPositions[0].x - horizontalPositions[1].x)).toBeGreaterThan(Math.abs(horizontalPositions[0].y - horizontalPositions[1].y))
    horizontalView.unmount()
    const vertical = spatialProps(2, 'vertical'), verticalView = render(<svg>{renderTransferArtwork({ project: vertical.project, station: vertical.station, lines: vertical.lines, style: vertical.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    const verticalPositions = pillPositions(verticalView.container)
    expect(Math.abs(verticalPositions[0].y - verticalPositions[1].y)).toBeGreaterThan(Math.abs(verticalPositions[0].x - verticalPositions[1].x))
  })

  it('packs 5/6 spatial pills without overlap and keeps a deterministic shell', () => {
    for (const count of [5, 6]) {
      const first = spatialProps(count), firstView = render(<svg>{renderTransferArtwork({ project: first.project, station: first.station, lines: first.lines, style: first.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      const firstPositions = pillPositions(firstView.container)
      expect(firstPositions).toHaveLength(count)
      for (let i = 0; i < firstPositions.length; i += 1) for (let j = i + 1; j < firstPositions.length; j += 1) {
        const left = firstPositions[i], right = firstPositions[j]
        const leftWidth = Number(left.rect.getAttribute('width')), rightWidth = Number(right.rect.getAttribute('width'))
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual((leftWidth + rightWidth) / 2)
      }
      const shell = firstView.container.querySelector('[data-guangzhou-shell="true"]') as SVGRectElement
      const shellLeft = Number(shell.getAttribute('x')), shellTop = Number(shell.getAttribute('y')), shellRight = shellLeft + Number(shell.getAttribute('width')), shellBottom = shellTop + Number(shell.getAttribute('height'))
      for (const item of firstPositions) {
        const left = Number(item.rect.getAttribute('x')), top = Number(item.rect.getAttribute('y'))
        expect(left).toBeGreaterThanOrEqual(shellLeft)
        expect(top).toBeGreaterThanOrEqual(shellTop)
        expect(left + Number(item.rect.getAttribute('width'))).toBeLessThanOrEqual(shellRight)
        expect(top + Number(item.rect.getAttribute('height'))).toBeLessThanOrEqual(shellBottom)
      }
      firstView.unmount()
      const second = spatialProps(count), secondView = render(<svg>{renderTransferArtwork({ project: second.project, station: second.station, lines: second.lines, style: second.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      expect(pillPositions(secondView.container).map(item => [item.x, item.y])).toEqual(firstPositions.map(item => [item.x, item.y]))
    }
  })

  it('keeps Guangzhou pill service mapping and leaves missing station codes blank', () => {
    const value = spatialProps(2)
    const relation = value.project.stationLineRelations.find(item => item.lineId === value.lines[1].id)!
    delete relation.stationCode
    const view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    const cells = [...view.container.querySelectorAll('[data-transfer-cell="true"]')]
    expect(cells.map(cell => cell.getAttribute('data-line-id'))).toEqual(value.lines.map(line => line.id))
    expect(cells[1].querySelector('[data-guangzhou-pill-station="true"]')).toHaveTextContent('')
  })

  it('uses fixed two arrows for Beijing and one dynamic N-arrow Kunming symbol', () => {
    const beijing = props(4, 'transfer.beijing.default'), b = render(<svg>{renderTransferArtwork({ project: beijing.project, station: beijing.station, lines: beijing.lines, style: beijing.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    expect(b.container.querySelectorAll('[data-transfer-arrow="true"]')).toHaveLength(2)
    b.unmount()
    for (const count of [2, 3, 4, 5, 6]) {
      const value = props(count, 'transfer.kunming'), view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      expect(view.container.querySelectorAll('[data-transfer-arrow="true"]')).toHaveLength(count)
      expect(view.container.querySelectorAll('[data-kunming-arrow-head="true"]')).toHaveLength(count)
      view.unmount()
    }
  })

  it('renders a substantial two-line Kunming capsule with mirrored U-turn arrows', () => {
    const value = props(2, 'transfer.kunming')
    const view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    const symbol = view.container.querySelector('[data-transfer-template="kunming"]')!
    const shell = symbol.querySelector('[data-kunming-shell="true"]')!
    expect(shell).toHaveAttribute('fill', 'white')
    expect(shell).toHaveAttribute('stroke', '#3f454a')
    expect(Number(shell.getAttribute('height'))).toBeGreaterThanOrEqual(16 * 2.6)
    expect(symbol.querySelectorAll('[data-kunming-arrow-mode="two-line-left"]')).toHaveLength(1)
    expect(symbol.querySelectorAll('[data-kunming-arrow-mode="two-line-right"]')).toHaveLength(1)
    expect([...symbol.querySelectorAll('[data-kunming-arrow="true"] path')].some(path => path.getAttribute('d')?.includes('C'))).toBe(true)
    expect([...symbol.querySelectorAll('[data-kunming-arrow="true"]')].map(node => node.getAttribute('fill'))).toEqual(value.lines.map(line => line.color))
    view.unmount()
  })

  it('uses a circular arrow mode for three or more services without dropping services', () => {
    for (const count of [3, 4, 5, 6]) {
      const value = props(count, 'transfer.kunming')
      const view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      const symbol = view.container.querySelector('[data-transfer-template="kunming"]')!
      expect(symbol).toHaveAttribute('data-kunming-shape', 'circle')
      expect(symbol.querySelectorAll('[data-kunming-arrow-mode="circular"]')).toHaveLength(count)
      expect(symbol.querySelectorAll('[data-kunming-arrow-head="true"]')).toHaveLength(count)
      expect(symbol.querySelectorAll('[data-kunming-arrow-mode="circular"] path[d*=" A "]')).toHaveLength(count)
      view.unmount()
    }
  })

  it('uses the established transfer metrics for default geometry', () => {
    const metrics = getDefaultTransferMetrics(16, 3, 5, 8, 20)
    expect(metrics.width).toBe(metrics.naturalWidth)
    expect(metrics.dotDiameter).toBeCloseTo(12.8)
  })
})
