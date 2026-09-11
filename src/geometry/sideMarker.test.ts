import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { resolveSideMarkerPlacement } from './sideMarker'

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
})
