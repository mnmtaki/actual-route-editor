import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import type { ActualRouteProject } from '../data/model'
import { getEffectiveRenderedLineWidthAtStation, resolveSideMarkerPlacement } from './sideMarker'

function routeProject(to = { x: 100, y: 0 }, lineWidth = 20): ActualRouteProject {
  const project = structuredClone(demoProject)
  project.settings.lineWidth = lineWidth
  project.stations = [
    { id: 'side-a', name: '起点', x: 0, y: 0, labelOffsetX: 0, labelOffsetY: 0 },
    { id: 'side-b', name: '终点', x: to.x, y: to.y, labelOffsetX: 0, labelOffsetY: 0 },
  ]
  project.lines = [{ id: 'side-line', name: '测试线', color: '#d34f45', stationSequence: ['side-a', 'side-b'], lineOrder: 0, visible: true, locked: false }]
  project.stationLineRelations = [{ id: 'side-relation-a', stationId: 'side-a', lineId: 'side-line', openedAt: '2000-01-01' }, { id: 'side-relation-b', stationId: 'side-b', lineId: 'side-line', openedAt: '2000-01-01' }]
  project.geometry.segments = [{ id: 'side-segment', lineId: 'side-line', fromStationId: 'side-a', toStationId: 'side-b', mode: 'straight', structureType: 'underground', waypoints: [] }]
  return project
}

describe('side marker placement', () => {
  it('keeps a deterministic offset on horizontal, vertical and diagonal lines', () => {
    const project = structuredClone(demoProject)
    const horizontalStation = { ...project.stations[0], id: 'horizontal-station', x: 200, y: 200 }
    const horizontalTarget = { ...project.stations[0], id: 'horizontal-target', x: 600, y: 200 }
    const verticalStation = { ...project.stations[0], id: 'vertical-station', x: 400, y: 400 }
    const verticalTarget = { ...project.stations[0], id: 'vertical-target', x: 400, y: 700 }
    project.stations.push(horizontalStation, horizontalTarget, verticalStation, verticalTarget)
    project.lines.push({ id: 'horizontal-line', name: '横线', color: '#000000', stationSequence: [horizontalStation.id, horizontalTarget.id], lineOrder: 8, visible: true, locked: false })
    project.lines.push({ id: 'vertical-line', name: '竖线', color: '#000000', stationSequence: [verticalStation.id, verticalTarget.id], lineOrder: 9, visible: true, locked: false })
    project.geometry.segments.push({ id: 'horizontal', lineId: 'horizontal-line', fromStationId: horizontalStation.id, toStationId: horizontalTarget.id, mode: 'straight', structureType: 'underground', waypoints: [] })
    project.geometry.segments.push({ id: 'vertical', lineId: 'vertical-line', fromStationId: verticalStation.id, toStationId: verticalTarget.id, mode: 'straight', structureType: 'underground', waypoints: [] })
    const horizontal = resolveSideMarkerPlacement(project, horizontalStation.id, 'horizontal-line', 16)
    expect(horizontal.y).toBeCloseTo(184)
    const vertical = resolveSideMarkerPlacement(project, verticalStation.id, 'vertical-line', 16)
    expect(vertical.x).toBeCloseTo(416)
    expect(vertical.y).toBeCloseTo(400)
    expect(Math.hypot(vertical.x - 400, vertical.y - 400)).toBeCloseTo(16)
  })

  it('keeps outward and inward marker edges exactly attached to the effective line body', () => {
    const project = routeProject()
    const outward = resolveSideMarkerPlacement(project, 'side-a', 'side-line', { placementMode: 'outward', depthRatio: 1.25, thicknessRatio: .5 })
    const inward = resolveSideMarkerPlacement(project, 'side-a', 'side-line', { placementMode: 'inward', depthRatio: .5, thicknessRatio: .35 })
    const anchor = project.stations[0]
    const signed = (placement: typeof outward) => (placement.x - anchor.x) * placement.normal.x + (placement.y - anchor.y) * placement.normal.y
    expect(signed(outward) - outward.depth / 2).toBeCloseTo(outward.lineWidth / 2)
    expect(signed(inward) + inward.depth / 2).toBeCloseTo(inward.lineWidth / 2)
    expect(inward.depth).toBeLessThan(inward.lineWidth)
    expect(outward.depth).toBeGreaterThan(outward.lineWidth)
  })

  it.each([
    ['horizontal', { x: 100, y: 0 }, 0],
    ['vertical', { x: 0, y: 100 }, 90],
    ['diagonal', { x: 100, y: 100 }, 45],
    ['arbitrary', { x: 120, y: 40 }, Math.atan2(40, 120) * 180 / Math.PI],
  ])('uses the local tangent for %s marker rotation', (_name, target, expectedAngle) => {
    const project = routeProject(target)
    const placement = resolveSideMarkerPlacement(project, 'side-a', 'side-line', { placementMode: 'outward', depthRatio: 1, thicknessRatio: .5 })
    expect(placement.rotation).toBeCloseTo(expectedAngle as number, 5)
  })

  it('uses relation anchor and remains deterministic when rendered repeatedly', () => {
    const project = routeProject()
    project.stationLineRelations[0].anchor = { x: 8, y: 12 }
    const first = resolveSideMarkerPlacement(project, 'side-a', 'side-line', { placementMode: 'outward', depthRatio: 1, thicknessRatio: .5 })
    const second = resolveSideMarkerPlacement(project, 'side-a', 'side-line', { placementMode: 'outward', depthRatio: 1, thicknessRatio: .5 })
    expect(first).toEqual(second)
    expect(first.anchorX).toBe(8)
    expect(first.anchorY).toBe(12)
  })

  it('follows a segment style layer when the rendered body is wider than the base line', () => {
    const project = routeProject()
    project.styles = [{ id: 'wide', name: '加宽', hideBaseLine: true, layers: [{ id: 'wide-layer', colorMode: 'followLine', width: 1.5, widthMode: 'ratio' }] }]
    project.geometry.segments[0].lineStyleId = 'wide'
    expect(getEffectiveRenderedLineWidthAtStation(project, 'side-a', 'side-line')).toBeCloseTo(30)
    const placement = resolveSideMarkerPlacement(project, 'side-a', 'side-line', { placementMode: 'inward', depthRatio: .5, thicknessRatio: .3 })
    expect(placement.lineWidth).toBeCloseTo(30)
  })
})
