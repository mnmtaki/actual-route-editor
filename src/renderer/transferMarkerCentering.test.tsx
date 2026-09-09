import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import rawChangling from '../import-export/__fixtures__/常陵.aarc-9.json'
import rawPinglan from '../import-export/__fixtures__/平岚.aarc (9).json'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { getTransferMarkerLayout } from '../geometry/tangent'
import { demoProject } from '../data/demo'
import { getDefaultTransferMetrics, getStationStyle } from './stationStyles'

function renderSyntheticTransfer(count: number, minMajorAxis: number) {
  const station = demoProject.stations[0]
  const lines = demoProject.lines.slice(0, count)
  const style = getStationStyle('default')
  const { container } = render(
    <svg>{style.renderTransfer({
      station,
      lines,
      size: 11,
      minorAxis: 19.5,
      dotGap: 2.25,
      endPadding: 5.15,
      rotation: 0,
      centerX: 0,
      centerY: 0,
      minMajorAxis,
    })}</svg>,
  )
  const frame = container.querySelector('rect')
  const dots = [...container.querySelectorAll('circle')]
  return { frame, dots }
}

function renderFixtureTransfer(project: ReturnType<typeof convertAarcToActualRouteProject>['project'], stationId: string) {
  const station = project.stations.find(item => item.id === stationId)
  if (!station) throw new Error('Missing fixture station ' + stationId)
  const relations = project.stationLineRelations.filter(relation => relation.stationId === stationId)
  const lines = relations
    .map(relation => project.lines.find(line => line.id === relation.lineId))
    .filter((line): line is NonNullable<typeof line> => Boolean(line))
  const layout = getTransferMarkerLayout(project, stationId, project.timeline.endDate, undefined, project.settings.transferEndPadding)
  const style = getStationStyle('default')
  const { container } = render(
    <svg>{style.renderTransfer({
      station,
      lines,
      size: project.settings.stationSize,
      minorAxis: project.settings.transferMinorAxis,
      dotGap: project.settings.transferDotGap,
      endPadding: project.settings.transferEndPadding,
      rotation: layout.rotation,
      centerX: layout.centerX,
      centerY: layout.centerY,
      minMajorAxis: layout.anchorSpan,
    })}</svg>,
  )
  const metrics = getDefaultTransferMetrics(
    project.settings.stationSize,
    lines.length,
    project.settings.transferDotGap,
    project.settings.transferEndPadding,
    project.settings.transferMinorAxis,
    layout.anchorSpan,
  )
  const theta = layout.rotation * Math.PI / 180
  const localXs = [...container.querySelectorAll('circle')].map(circle => {
    const x = Number(circle.getAttribute('cx')) - layout.centerX
    const y = Number(circle.getAttribute('cy')) - layout.centerY
    return x * Math.cos(theta) + y * Math.sin(theta)
  })
  return { layout, metrics, localXs, frameWidth: Number(container.querySelector('rect')?.getAttribute('width')) }
}

describe('transfer marker content centering', () => {
  it('keeps the existing dot positions when marker width equals natural content width', () => {
    const natural = getDefaultTransferMetrics(11, 2, 2.25, 5.15, 19.5).naturalWidth
    const { frame, dots } = renderSyntheticTransfer(2, natural)
    expect(Number(frame?.getAttribute('width'))).toBeCloseTo(natural)
    const xs = dots.map(dot => Number(dot.getAttribute('cx')))
    expect(xs[0]).toBeCloseTo(-5.525)
    expect(xs[1]).toBeCloseTo(5.525)
  })

  it('centers two-line content when the final capsule is expanded', () => {
    const { frame, dots } = renderSyntheticTransfer(2, 35.3)
    expect(Number(frame?.getAttribute('width'))).toBeCloseTo(35.3)
    const xs = dots.map(dot => Number(dot.getAttribute('cx')))
    expect((xs[0] + xs[1]) / 2).toBeCloseTo(0)
    expect(xs[0]).toBeCloseTo(-xs[1])
  })

  it('centers three-line content with the middle dot on the marker axis', () => {
    const { frame, dots } = renderSyntheticTransfer(3, 50)
    expect(Number(frame?.getAttribute('width'))).toBeCloseTo(50)
    const xs = dots.map(dot => Number(dot.getAttribute('cx')))
    expect(xs[1]).toBeCloseTo(0)
    expect(xs[0] + xs[2]).toBeCloseTo(0)
  })

  it('keeps Pinglan expanded markers centered at YunGu Center, YunGu South and ChiTuYan', () => {
    const project = convertAarcToActualRouteProject(rawPinglan, 'Pinglan.aarc (9).json').project
    for (const stationId of ['aarc-station-466', 'aarc-station-467', 'aarc-station-563']) {
      const { layout, metrics, localXs, frameWidth } = renderFixtureTransfer(project, stationId)
      expect(layout.anchorSpan).toBeGreaterThan(metrics.naturalWidth)
      expect(frameWidth).toBeCloseTo(layout.anchorSpan)
      expect(localXs.reduce((sum, value) => sum + value, 0) / localXs.length).toBeCloseTo(0)
    }
  })

  it('keeps normal Changling markers unchanged when no width expansion is needed', () => {
    const project = convertAarcToActualRouteProject(rawChangling, 'Changling.aarc-9.json').project
    for (const stationId of ['aarc-station-29', 'aarc-station-44']) {
      const { layout, metrics, localXs, frameWidth } = renderFixtureTransfer(project, stationId)
      expect(layout.anchorSpan).toBeLessThanOrEqual(metrics.naturalWidth)
      expect(frameWidth).toBeCloseTo(metrics.naturalWidth)
      expect(localXs.reduce((sum, value) => sum + value, 0) / localXs.length).toBeCloseTo(0)
    }
  })
})
