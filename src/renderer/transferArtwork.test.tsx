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
      view.unmount()
    }
    const incompatible = props(5, 'transfer.guangzhou.classic'), view = render(<svg>{renderTransferArtwork({ project: incompatible.project, station: incompatible.station, lines: incompatible.lines, style: incompatible.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    expect(view.container.querySelector('[data-transfer-incompatible="true"]')).toBeTruthy()
  })

  it('keeps Guangzhou 2024 cell count equal to service count for 2–6 lines', () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const value = props(count, 'transfer.guangzhou.2024'), view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      expect(view.container.querySelectorAll('[data-transfer-cell="true"]')).toHaveLength(count)
      view.unmount()
    }
  })

  it('uses fixed two arrows for Beijing and N arrows for Kunming 2/3+', () => {
    const beijing = props(4, 'transfer.beijing.default'), b = render(<svg>{renderTransferArtwork({ project: beijing.project, station: beijing.station, lines: beijing.lines, style: beijing.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
    expect(b.container.querySelectorAll('[data-transfer-arrow="true"]')).toHaveLength(2)
    b.unmount()
    for (const count of [2, 3, 4, 6]) {
      const value = props(count, count === 2 ? 'transfer.kunming.two' : 'transfer.kunming.three'), view = render(<svg>{renderTransferArtwork({ project: value.project, station: value.station, lines: value.lines, style: value.style, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8 })}</svg>)
      expect(view.container.querySelectorAll('[data-transfer-arrow="true"]')).toHaveLength(count)
      view.unmount()
    }
  })

  it('uses the established transfer metrics for default geometry', () => {
    const metrics = getDefaultTransferMetrics(16, 3, 5, 8, 20)
    expect(metrics.width).toBe(metrics.naturalWidth)
    expect(metrics.dotDiameter).toBeCloseTo(12.8)
  })
})
