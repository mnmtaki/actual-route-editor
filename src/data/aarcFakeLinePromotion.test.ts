import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './storage'
import { materializeAarcFakeLineEntries } from './aarcFakeLineEntries'
import { setLineFake } from './fakeLines'
import { getPassengerStationCount, getPassengerStationCountForLine } from './passengerStats'
import { getActiveNetworkAtTime } from '../timeline/active'

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
})
