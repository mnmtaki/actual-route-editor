import { describe, expect, it } from 'vitest'
import { snapPointToAlignment, type AlignmentCandidate } from './alignmentSnap'

const candidates: AlignmentCandidate[] = [
  { id: 'station-a', x: 100, y: 200, kind: 'station' },
  { id: 'waypoint-a', x: 300, y: 400, kind: 'waypoint' },
]

describe('alignment snapping', () => {
  it('snaps x and y independently to nearby geometry', () => {
    const result = snapPointToAlignment({ x: 104, y: 396 }, candidates, { x: 8, y: 8 })
    expect(result.point).toEqual({ x: 100, y: 400 })
    expect(result.guides.map(guide => [guide.axis, guide.value])).toEqual([['x', 100], ['y', 400]])
  })

  it('keeps the raw coordinate outside the screen-derived threshold', () => {
    const result = snapPointToAlignment({ x: 112, y: 390 }, candidates, { x: 8, y: 8 })
    expect(result.point).toEqual({ x: 112, y: 390 })
    expect(result.guides).toEqual([])
  })

  it('prefers Station alignment over a Waypoint at the same distance', () => {
    const result = snapPointToAlignment({ x: 105, y: 200 }, [
      { id: 'waypoint', x: 110, y: 200, kind: 'waypoint' },
      { id: 'station', x: 100, y: 200, kind: 'station' },
    ], { x: 8, y: 8 })
    expect(result.point.x).toBe(100)
    expect(result.guides[0]).toMatchObject({ targetId: 'station', targetKind: 'station' })
  })
})
