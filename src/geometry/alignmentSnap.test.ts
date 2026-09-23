import { describe, expect, it } from 'vitest'
import { snapEditorPoint, snapNeighborRays, type SnapNode } from './alignmentSnap'

describe('AARC-style editor snapping', () => {
  it('projects to a nearby 45° neighbor ray', () => {
    const result = snapNeighborRays(
      { x: 52, y: 46 },
      [{ id: 'neighbor', x: 0, y: 100 }],
      6,
      [45],
    )
    expect(result).toBeDefined()
    expect(result!.point.x + result!.point.y).toBeCloseTo(100, 8)
    expect(result!.guides).toHaveLength(1)
    expect(result!.guides[0].kind).toBe('ray')
  })

  it('uses the nearby intersection of rays from two different neighbors', () => {
    const result = snapNeighborRays(
      { x: 52, y: 48 },
      [
        { id: 'horizontal-source', x: 0, y: 50 },
        { id: 'vertical-source', x: 50, y: 0 },
      ],
      5,
      [0, 90],
    )
    expect(result?.point).toEqual({ x: 50, y: 50 })
    expect(result?.guides).toHaveLength(2)
  })

  it('does not jump to a far intersection', () => {
    const result = snapNeighborRays(
      { x: 0, y: 0 },
      [
        { id: 'a', x: 0, y: 2 },
        { id: 'b', x: 20, y: 2.5 },
      ],
      3,
      [0, 5],
    )
    expect(result).toBeDefined()
    expect(Math.hypot(result!.point.x, result!.point.y)).toBeLessThanOrEqual(6)
    expect(result!.guides).toHaveLength(1)
  })

  it('gives direct node snapping priority over ray and grid snapping', () => {
    const nodes: SnapNode[] = [
      { id: 'waypoint', x: 102, y: 98, kind: 'waypoint' },
      { id: 'station', x: 100, y: 100, kind: 'station' },
    ]
    const result = snapEditorPoint(
      { x: 101, y: 101 },
      { node: true, neighbor: true, grid: true },
      { node: 4, ray: 10, grid: 6 },
      {
        nodes,
        neighbors: [{ id: 'neighbor', x: 0, y: 0 }],
        gridInterval: 40,
      },
    )
    expect(result.point).toEqual({ x: 100, y: 100 })
    expect(result.guides).toEqual([{ kind: 'node', point: { x: 100, y: 100 } }])
  })

  it('can combine one neighbor ray with grid snapping while staying on the ray', () => {
    const result = snapEditorPoint(
      { x: 39, y: 41 },
      { node: false, neighbor: true, grid: true },
      { node: 0, ray: 4, grid: 3 },
      {
        neighbors: [{ id: 'diag', x: 0, y: 80 }],
        gridInterval: 40,
        angles: [45],
      },
    )
    expect(result.point.x + result.point.y).toBeCloseTo(80, 8)
    expect(result.guides.some(guide => guide.kind === 'ray')).toBe(true)
    expect(result.guides.some(guide => guide.kind.startsWith('grid-'))).toBe(true)
  })

  it('keeps the raw point when all snap modes are disabled', () => {
    const result = snapEditorPoint(
      { x: 13, y: 17 },
      { node: false, neighbor: false, grid: false },
      { node: 10, ray: 16, grid: 6 },
      { gridInterval: 40 },
    )
    expect(result.point).toEqual({ x: 13, y: 17 })
    expect(result.guides).toEqual([])
  })
})
