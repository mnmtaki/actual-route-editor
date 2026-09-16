import { describe, expect, it } from 'vitest'
import { formalizeAarcControlPoints } from './aarcFormalize'

const p = (id: number, x: number, y: number, dir: 0 | 1 = 0, free = false) => ({ id, x, y, dir, ...(free ? { free: true } : {}) })
const xy = (points: ReturnType<typeof formalizeAarcControlPoints>) => points.map(point => [point.x, point.y])
const after = (points: ReturnType<typeof formalizeAarcControlPoints>) => points.map(point => point.afterIdxEqv)

describe('AARC formalize parity', () => {
  it('matches upstream for fewer than two control points', () => {
    expect(formalizeAarcControlPoints([])).toEqual([])
    expect(formalizeAarcControlPoints([p(1, 0, 0)])).toEqual([])
  })

  it.each([
    ['vertical shallow', [p(1, 0, 0, 0), p(2, 20, 10, 0)], [[0, 0], [5, 0], [15, 10], [20, 10]], [0, 0, 0, 1]],
    ['incline shallow', [p(1, 0, 0, 1), p(2, 20, 10, 1)], [[0, 0], [5, 5], [15, 5], [20, 10]], [0, 0, 0, 1]],
    ['vertical to incline', [p(1, 0, 0, 0), p(2, 20, 10, 1)], [[0, 0], [10, 0], [20, 10]], [0, 0, 1]],
    ['incline to vertical', [p(1, 0, 0, 1), p(2, 20, 10, 0)], [[0, 0], [10, 10], [20, 10]], [0, 0, 1]],
  ] as const)('%s uses the same coordFill result as upstream', (_name, input, expected, expectedAfter) => {
    const result = formalizeAarcControlPoints([...input])
    expect(xy(result)).toEqual(expected)
    expect(after(result)).toEqual(expectedAfter)
  })

  it('matches upstream middle ill-posed correction', () => {
    const result = formalizeAarcControlPoints([
      p(1, 0, 0, 0), p(2, 10, 0, 0), p(3, 20, 10, 0), p(4, 20, 20, 0),
    ])
    expect(xy(result)).toEqual([[0, 0], [10, 0], [20, 0], [20, 10], [20, 20]])
    expect(after(result)).toEqual([0, 1, 1, 2, 3])
  })

  it('matches upstream end ill-posed correction', () => {
    const result = formalizeAarcControlPoints([p(1, 0, 0, 0), p(2, 10, 10, 0), p(3, 20, 10, 0)])
    expect(xy(result)).toEqual([[0, 0], [0, 10], [10, 10], [20, 10]])
    expect(after(result)).toEqual([0, 0, 1, 2])
  })

  it('matches upstream ring margin correction', () => {
    const result = formalizeAarcControlPoints([p(1, 0, 0, 0), p(2, 10, 0, 0), p(3, 10, 10, 0), p(1, 0, 0, 0)])
    expect(xy(result)).toEqual([[0, 0], [10, 0], [10, 10], [10, 0], [0, 0]])
    expect(after(result)).toEqual([0, 1, 2, 2, 3])
  })

  it('keeps both legs adjacent to a free point direct', () => {
    const result = formalizeAarcControlPoints([p(1, 0, 0, 0), p(2, 13, 7, 0, true), p(3, 30, 0, 0)])
    expect(xy(result)).toEqual([[0, 0], [13, 7], [30, 0]])
    expect(after(result)).toEqual([0, 1, 2])
    expect(result[1].free).toBe(true)
  })
})
