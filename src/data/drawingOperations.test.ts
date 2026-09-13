import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { demoProject } from './demo'
import { appendStationToLineWithWaypoints, connectExistingStationWithWaypoints, createLine, demoteTerminalStationToDrawingPoint } from './operations'

describe('line drawing geometry operations', () => {
  it('commits draft control points into the station-to-station Segment', () => {
    const created = createLine(createEmptyProject(), { name: '绘制测试', color: '#336699' })
    const first = appendStationToLineWithWaypoints(created.project, created.lineId, { x: 100, y: 100 }, [], null)
    const second = appendStationToLineWithWaypoints(first.project, created.lineId, { x: 420, y: 240 }, [
      { id: 'draft-a', x: 190, y: 150 },
      { id: 'draft-b', x: 310, y: 180 },
    ], first.stationId)
    const segment = second.project.geometry.segments.find(item => item.id === second.segmentId)
    expect(segment?.fromStationId).toBe(first.stationId)
    expect(segment?.toStationId).toBe(second.stationId)
    expect(segment?.waypoints.map(item => [item.id, item.x, item.y])).toEqual([
      ['draft-a', 190, 150],
      ['draft-b', 310, 180],
    ])
    expect(segment?.mode).toBe('smooth')
  })

  it('connects to an existing Station without losing draft control points', () => {
    const created = createLine(structuredClone(demoProject), { name: '接入测试', color: '#663399' })
    const first = connectExistingStationWithWaypoints(created.project, created.lineId, 's1', [], null)
    const second = connectExistingStationWithWaypoints(first.project, created.lineId, 's2', [{ id: 'draft-c', x: 250, y: 260 }], 's1')
    const segment = second.project.geometry.segments.find(item => item.id === second.segmentId)
    expect(segment?.fromStationId).toBe('s1')
    expect(segment?.toStationId).toBe('s2')
    expect(segment?.waypoints).toMatchObject([{ id: 'draft-c', x: 250, y: 260 }])
  })

  it('can switch the just-created terminal Station back into a control point', () => {
    const created = createLine(createEmptyProject(), { name: '切换测试', color: '#227755' })
    const first = appendStationToLineWithWaypoints(created.project, created.lineId, { x: 100, y: 100 }, [], null)
    const second = appendStationToLineWithWaypoints(first.project, created.lineId, { x: 400, y: 220 }, [{ id: 'curve', x: 250, y: 180 }], first.stationId)
    const demoted = demoteTerminalStationToDrawingPoint(second.project, created.lineId, second.stationId)
    expect(demoted?.anchorStationId).toBe(first.stationId)
    expect(demoted?.draftPoints.map(item => item.id)).toEqual(['curve', expect.any(String)])
    expect(demoted?.draftPoints.at(-1)).toMatchObject({ x: 400, y: 220 })
    expect(demoted?.project.stations.some(item => item.id === second.stationId)).toBe(false)
    expect(demoted?.project.geometry.segments).toHaveLength(0)
  })
})
