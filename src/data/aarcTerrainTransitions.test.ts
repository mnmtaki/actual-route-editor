import { describe, expect, it } from 'vitest'
import type { BasemapPath } from './model'
import { buildAarcTerrainTransitionPaths } from './aarcTerrainTransitions'

function path(id: string, color: string, points: Array<[number, number, number]>): BasemapPath {
  return {
    id,
    category: 'water',
    points: points.map(([aarcPointId, x, y], index) => ({ id: `${id}-${index}`, x, y, aarcPointId, aarcDir: 0 })),
    color,
    width: 14,
    opacity: 1,
    closed: false,
    isFilled: false,
    zIndex: 0,
    visible: true,
    locked: false,
    geometry: { kind: 'aarc', lineTurnAreaRadius: 30, lineWidthBase: 14, lineCarpetWiden: 7, backgroundColor: '#ffffff' },
    source: { format: 'aarc', sourceLineId: id === 'a' ? 1 : 2, sourceWidthRatio: 1 },
  }
}

describe('AARC terrain shared-point transitions', () => {
  it('recreates the rounded wedge between same-color terrain lines sharing an AARC point', () => {
    const transitions = buildAarcTerrainTransitionPaths([
      path('a', '#123456', [[1, 0, 0], [2, 100, 0]]),
      path('b', '#123456', [[1, 0, 0], [3, 0, 100]]),
    ])
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({ color: '#123456', carpetColor: '#ffffff', carpetWidth: 7 })
    expect(transitions[0].d).toContain('A ')
    expect(transitions[0].d.endsWith('Z')).toBe(true)
  })

  it('does not bridge terrain lines of different colors', () => {
    expect(buildAarcTerrainTransitionPaths([
      path('a', '#123456', [[1, 0, 0], [2, 100, 0]]),
      path('b', '#654321', [[1, 0, 0], [3, 0, 100]]),
    ])).toEqual([])
  })
})
