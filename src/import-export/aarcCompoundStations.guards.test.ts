import { describe, expect, it } from 'vitest'
import { detectAarcCompoundGroups } from './aarcCompoundStations'

function detect(distance: number, memberships: number[][], names: [string?, string?] = [], chain = [1, 2]) {
  const points = [{ id: 1, x: 0, y: 0, sta: 1, ...(names[0] ? { name: names[0] } : {}) }, { id: 2, x: distance, y: 0, sta: 1, ...(names[1] ? { name: names[1] } : {}) }]
  const lines = [{ id: 10, pts: chain }, { id: 20, pts: [1, 8] }, { id: 30, pts: [2, 9] }]
  return detectAarcCompoundGroups(points, lines, new Map([[1, [10, ...memberships[0]]], [2, [10, ...memberships[1]]]]))
}

describe('AARC compound source-oracle semantics', () => {
  it('uses geometric proximity and memberships, without speculative business gates', () => {
    expect(detect(20, [[], [30]]).groups).toHaveLength(1)
    expect(detect(20, [[20], []]).groups).toHaveLength(1)
    expect(detect(20, [[20], [30]], ['甲', '乙']).groups).toHaveLength(1)
    expect(detect(20, [[20], [30]], [], [1, 8, 2]).groups).toHaveLength(1)
    expect(detect(20, [[20], [20]]).groups).toHaveLength(1)
  })

  it('does not cluster points outside the upstream clinging distance', () => {
    expect(detect(26, [[20], [30]]).groups).toHaveLength(0)
  })
})