import { describe, expect, it } from 'vitest'
import { importTopologyJson } from './topologyAdapter'

describe('legacy topology adapter', () => {
  it('filters guide lines, preserves sequence, merges explicit point links, and does not reuse legacy coordinates', () => {
    const source = JSON.stringify({
      lines: [
        { id: 1, name: '1', color: '#f00', pts: [1, 2, 3], type: 0 },
        { id: 2, name: '辅助', pts: [4, 5], type: 1 },
        { id: 3, name: '假线', pts: [6, 7], isFake: true },
      ],
      points: [
        { id: 1, name: '甲', pos: [9999, 9999], sta: 1 },
        { id: 2, name: '乙', pos: [8000, 8000], sta: 1 },
        { id: 3, name: '丙', pos: [7000, 7000], sta: 1 },
        { id: 4, name: '装饰', sta: 1 }, { id: 5, name: '装饰二', sta: 1 }, { id: 6, name: '假', sta: 1 }, { id: 7, name: '假二', sta: 1 },
      ],
      pointLinks: [{ pts: [1, 1] }],
    })
    const project = importTopologyJson(source)
    expect(project.lines).toHaveLength(1)
    expect(project.lines[0].stationSequence).toHaveLength(3)
    expect(project.geometry.segments).toHaveLength(2)
    expect(project.stations[0].x).not.toBe(9999)
  })
})
