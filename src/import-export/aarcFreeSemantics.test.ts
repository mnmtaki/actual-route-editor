import { describe, expect, it } from 'vitest'
import { reconstructAarcLineGeometry } from './aarcGeometry'
import { buildAarcStationComponents, createAarcFreeSnapCandidateResolver } from './aarcStationClustering'

describe('AARC free-point semantics', () => {
  it('keeps an edge adjacent to a free point direct and preserves coordinates', () => {
    const result = reconstructAarcLineGeometry([
      { id: 1, x: 0, y: 0, dir: 0, station: true },
      { id: 2, x: 23, y: 17, dir: 1, station: true, free: true },
      { id: 3, x: 80, y: 17, dir: 0, station: true },
    ])
    expect(result.stats.directLegCount).toBe(2)
    expect(result.nodes.map(node => [node.x, node.y, node.free])).toEqual([[0, 0, undefined], [23, 17, true], [80, 17, undefined]])
  })

  it('supports free cluster off/strict/loose modes and candidate positions', () => {
    const points = [{ id: 1, x: 0, y: 0, sourceOrder: 0, free: true }, { id: 2, x: 100, y: 0, sourceOrder: 1 }]
    const memberships = new Map([[1, [1]], [2, [2]]])
    const candidates = (point: { id: number }) => point.id === 1 ? { candidates: [[100, 0] as [number, number]] } : { candidates: [[100, 0] as [number, number]] }
    expect(buildAarcStationComponents(points, memberships, [], { configClingingDist: 25, getSnapSize: () => 1, freeClusterMode: 'off', getSnapCandidates: candidates }).components).toHaveLength(2)
    expect(buildAarcStationComponents(points, memberships, [], { configClingingDist: 25, getSnapSize: () => 1, freeClusterMode: 'loose', getSnapCandidates: candidates, getSnapThreshold: () => 0 }).components).toHaveLength(1)
    const strictCandidates = (point: { id: number }) => point.id === 1 ? { candidates: [[99, 0] as [number, number]] } : { candidates: [[99, 0] as [number, number]] }
    expect(buildAarcStationComponents(points, memberships, [], { configClingingDist: 25, getSnapSize: () => 1, freeClusterMode: 'strict', getSnapCandidates: strictCandidates, getSnapThreshold: () => 0 }).components).toHaveLength(2)
  })
  it('generates upstream-style free-point candidates from each source occurrence', () => {
    const resolver = createAarcFreeSnapCandidateResolver(new Map([[1, { x: 0, y: 0 }], [2, { x: 0, y: 100 }], [3, { x: 100, y: 0 }]]), [{ pts: [2, 1, 3] }], () => 10)
    const info = resolver({ id: 1, x: 0, y: 0, sourceOrder: 0, free: true })
    expect(info.candidates).toEqual(expect.arrayContaining([[0, 0], [10, 10], [-10, -10], [-10, 0], [0, -10]]))
    expect(info.bbox!.minX).toBe(-10)
    expect(info.bbox!.maxY).toBe(10)
  })

})
