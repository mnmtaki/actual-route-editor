import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { materializeAarcFakeLineEntries } from './aarcFakeLineEntries'
import { setLineFake } from './fakeLines'
import { getPassengerStationCount, getPassengerStationCountForLine } from './passengerStats'
import { getActiveNetworkAtTime } from '../timeline/active'
import { getPassengerStationIdentity } from './compoundStation'

describe('AARC fake line reversible promotion', () => {
  it('materializes source stations and geometry when restored, then freezes them again without deleting topology', () => {
    const seed = createEmptyProject()
    seed.aarc = {
      format: 'aarc',
      raw: {
        lines: [{ id: 7, name: '图例线', color: '#123456', type: 0, isFake: true, pts: [1, 2, 3] }],
        points: [
          { id: 1, pos: [0, 0], sta: 1, dir: 0, name: '甲' },
          { id: 2, pos: [100, 0], sta: 1, dir: 0, name: '乙' },
          { id: 3, pos: [200, 0], sta: 1, dir: 0, name: '丙' },
        ],
      },
    }
    const imported = materializeAarcFakeLineEntries(seed)
    const lineId = imported.lines[0].id
    expect(imported.lines[0].isFake).toBe(true)
    expect(imported.geometry.segments).toHaveLength(0)
    expect(imported.stationLineRelations).toHaveLength(0)

    const restored = setLineFake(imported, lineId, false)
    expect(restored.lines[0].isFake).toBeUndefined()
    expect(restored.lines[0].stationSequence).toHaveLength(3)
    expect(restored.geometry.segments.filter(segment => segment.lineId === lineId)).toHaveLength(2)
    expect(restored.stationLineRelations.filter(relation => relation.lineId === lineId)).toHaveLength(3)
    expect(getPassengerStationCountForLine(restored, lineId)).toBe(3)
    expect(getPassengerStationCount(restored)).toBe(3)
    expect((restored.aarc?.raw?.lines as Array<{ isFake?: boolean }>)[0].isFake).toBe(false)
    expect(getActiveNetworkAtTime(restored, restored.timeline.currentDate).segments).toHaveLength(2)

    const frozen = setLineFake(restored, lineId, true)
    expect(frozen.lines[0].isFake).toBe(true)
    expect(frozen.lines[0].stationSequence).toHaveLength(3)
    expect(frozen.geometry.segments.filter(segment => segment.lineId === lineId)).toHaveLength(2)
    expect(frozen.stationLineRelations.filter(relation => relation.lineId === lineId)).toHaveLength(3)
    expect(getPassengerStationCountForLine(frozen, lineId)).toBe(0)
    expect(getPassengerStationCount(frozen)).toBe(0)
    expect((frozen.aarc?.raw?.lines as Array<{ isFake?: boolean }>)[0].isFake).toBe(true)
    expect(getActiveNetworkAtTime(frozen, frozen.timeline.currentDate).segments).toHaveLength(0)

    const restoredAgain = setLineFake(frozen, lineId, false)
    expect(restoredAgain.lines[0].stationSequence).toHaveLength(3)
    expect(restoredAgain.geometry.segments.filter(segment => segment.lineId === lineId)).toHaveLength(2)
    expect(restoredAgain.stationLineRelations.filter(relation => relation.lineId === lineId)).toHaveLength(3)
    expect(getPassengerStationCountForLine(restoredAgain, lineId)).toBe(3)
  })

  it('reuses an existing real station when the promoted fake station belongs to the same automatic AARC cluster', () => {
    const seed = createEmptyProject()
    seed.aarc = {
      format: 'aarc',
      config: { snapOctaClingPtPtDist: 25 },
      raw: {
        config: { snapOctaClingPtPtDist: 25 },
        lines: [
          { id: 1, name: '运营线', color: '#cc0000', type: 0, pts: [1, 2] },
          { id: 7, name: '图例线', color: '#123456', type: 0, isFake: true, pts: [3, 4] },
        ],
        points: [
          { id: 1, pos: [0, 0], sta: 1, dir: 0, name: '甲' },
          { id: 2, pos: [100, 0], sta: 1, dir: 0, name: '乙' },
          { id: 3, pos: [15, 0], sta: 1, dir: 0 },
          { id: 4, pos: [200, 0], sta: 1, dir: 0, name: '丙' },
        ],
      },
    }
    seed.lines = [{ id: 'aarc-line-1', name: '运营线', color: '#cc0000', stationSequence: ['aarc-station-1', 'aarc-station-2'], lineOrder: 0, visible: true, locked: false, source: { format: 'aarc', lineId: 1, sourceLineId: 1, raw: { id: 1 } } }]
    seed.stations = [
      { id: 'aarc-station-1', name: '甲', x: 0, y: 0, labelOffsetX: 14, labelOffsetY: -14, source: { format: 'aarc', pointId: 1, pointIds: [1], raw: { id: 1, name: '甲' } } },
      { id: 'aarc-station-2', name: '乙', x: 100, y: 0, labelOffsetX: 14, labelOffsetY: -14, source: { format: 'aarc', pointId: 2, pointIds: [2], raw: { id: 2, name: '乙' } } },
    ]
    seed.stationLineRelations = [
      { id: 'r1', stationId: 'aarc-station-1', lineId: 'aarc-line-1' },
      { id: 'r2', stationId: 'aarc-station-2', lineId: 'aarc-line-1' },
    ]
    seed.geometry.segments = [{ id: 's1', lineId: 'aarc-line-1', fromStationId: 'aarc-station-1', toStationId: 'aarc-station-2', mode: 'straight', structureType: 'underground', structureNodes: [], waypoints: [] }]

    const imported = materializeAarcFakeLineEntries(seed)
    const fakeId = imported.lines.find(line => line.source?.sourceLineId === 7)!.id
    const restored = setLineFake(imported, fakeId, false)

    expect(restored.stations.filter(station => station.source?.pointId === 3)).toHaveLength(0)
    expect(restored.lines.find(line => line.id === fakeId)?.stationSequence[0]).toBe('aarc-station-1')
    expect(restored.stations.find(station => station.id === 'aarc-station-1')?.source?.pointIds).toEqual(expect.arrayContaining([1, 3]))
    expect(restored.stationLineRelations.filter(relation => relation.lineId === fakeId).map(relation => relation.stationId)).toContain('aarc-station-1')
  })

  it('maps AARC pointLinks type=4 to one passenger compound when a fake line is promoted', () => {
    const seed = createEmptyProject()
    seed.aarc = {
      format: 'aarc',
      pointLinks: [{ type: 4, pts: [2, 3] }],
      raw: {
        lines: [
          { id: 1, name: '运营线', color: '#cc0000', type: 0, pts: [1, 2] },
          { id: 7, name: '图例线', color: '#123456', type: 0, isFake: true, pts: [3, 4] },
        ],
        points: [
          { id: 1, pos: [0, 0], sta: 1, dir: 0, name: '甲' },
          { id: 2, pos: [100, 0], sta: 1, dir: 0, name: '换乘甲' },
          { id: 3, pos: [220, 0], sta: 1, dir: 0, name: '换乘乙' },
          { id: 4, pos: [320, 0], sta: 1, dir: 0, name: '丙' },
        ],
        pointLinks: [{ type: 4, pts: [2, 3] }],
      },
    }
    seed.lines = [{ id: 'aarc-line-1', name: '运营线', color: '#cc0000', stationSequence: ['aarc-station-1', 'aarc-station-2'], lineOrder: 0, visible: true, locked: false, source: { format: 'aarc', lineId: 1, sourceLineId: 1, raw: { id: 1 } } }]
    seed.stations = [
      { id: 'aarc-station-1', name: '甲', x: 0, y: 0, labelOffsetX: 14, labelOffsetY: -14, source: { format: 'aarc', pointId: 1, pointIds: [1], raw: { id: 1, name: '甲' } } },
      { id: 'aarc-station-2', name: '换乘甲', x: 100, y: 0, labelOffsetX: 14, labelOffsetY: -14, source: { format: 'aarc', pointId: 2, pointIds: [2], raw: { id: 2, name: '换乘甲' } } },
    ]
    seed.stationLineRelations = [
      { id: 'r1', stationId: 'aarc-station-1', lineId: 'aarc-line-1' },
      { id: 'r2', stationId: 'aarc-station-2', lineId: 'aarc-line-1' },
    ]
    seed.geometry.segments = [{ id: 's1', lineId: 'aarc-line-1', fromStationId: 'aarc-station-1', toStationId: 'aarc-station-2', mode: 'straight', structureType: 'underground', structureNodes: [], waypoints: [] }]

    const imported = materializeAarcFakeLineEntries(seed)
    const fakeId = imported.lines.find(line => line.source?.sourceLineId === 7)!.id
    const restored = setLineFake(imported, fakeId, false)
    const promoted = restored.stations.find(station => station.source?.pointId === 3)!

    expect(promoted).toBeTruthy()
    expect(promoted.compoundGroupId).toBe('aarc-compound-2-3')
    expect(restored.stations.find(station => station.id === 'aarc-station-2')?.compoundGroupId).toBe('aarc-compound-2-3')
    expect(getPassengerStationIdentity(restored, promoted)).toBe(getPassengerStationIdentity(restored, 'aarc-station-2'))

    const frozen = setLineFake(restored, fakeId, true)
    const restoredAgain = setLineFake(frozen, fakeId, false)
    expect(restoredAgain.stations.length).toBe(restored.stations.length)
    expect(restoredAgain.stationLineRelations.length).toBe(restored.stationLineRelations.length)
    expect(restoredAgain.geometry.segments.length).toBe(restored.geometry.segments.length)
  })
})
