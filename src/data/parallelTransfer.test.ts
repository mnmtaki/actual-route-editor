import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { createLine, appendStationToLineWithWaypoints } from './operations'
import { adaptParallelTransfer } from './parallelTransfer'

describe('parallel transfer adaptation', () => {
  it('adds independent per-line station anchors without changing the original segments', () => {
    const first = createLine(createEmptyProject(), { name: '黄色', color: '#eebb22' })
    const a = appendStationToLineWithWaypoints(first.project, first.lineId, { x: -100, y: -100 }, [])
    const middle = appendStationToLineWithWaypoints(a.project, first.lineId, { x: 0, y: 0 }, [], a.stationId)
    const b = appendStationToLineWithWaypoints(middle.project, first.lineId, { x: 100, y: 100 }, [], middle.stationId)
    const orange = createLine(b.project, { name: '橙色', color: '#dd7711' })
    const c = appendStationToLineWithWaypoints(orange.project, orange.lineId, { x: 0, y: -150 }, [])
    const d = appendStationToLineWithWaypoints(c.project, orange.lineId, { x: 0, y: 0 }, [], c.stationId)
    const e = appendStationToLineWithWaypoints(d.project, orange.lineId, { x: 20, y: 130 }, [], d.stationId)
    const input = e.project
    input.stations.find(station => station.id === middle.stationId)!.compoundGroupId = 'transfer'
    input.stations.find(station => station.id === d.stationId)!.compoundGroupId = 'transfer'
    const originalSegments = structuredClone(input.geometry.segments)
    const result = adaptParallelTransfer(input, middle.stationId, { lineIds: [first.lineId, orange.lineId], spacing: 24, centerDx: 4, centerDy: -3 })
    expect(result.geometry.segments).toEqual(originalSegments)
    expect(input.stationLineRelations.some(relation => relation.anchor)).toBe(false)
    const anchors = result.stationLineRelations.filter(relation => relation.stationId === middle.stationId || relation.stationId === d.stationId).map(relation => relation.anchor)
    expect(anchors).toHaveLength(2)
    expect(anchors.every(Boolean)).toBe(true)
    expect(Math.hypot(anchors[0]!.x - anchors[1]!.x, anchors[0]!.y - anchors[1]!.y)).toBeCloseTo(24)
    expect(result.stations.find(station => station.id === middle.stationId)!.x).toBe(4)
  })
  it('rejects a single-line adaptation', () => {
    const project = createEmptyProject()
    expect(() => adaptParallelTransfer(project, 'missing', { lineIds: ['a'], spacing: 18, centerDx: 0, centerDy: 0 })).toThrow()
  })
})
