import { describe, expect, it } from 'vitest'
import { classifyLeg, reconstructAarcLineGeometry, type AarcGeometryPoint } from './aarcGeometry'
import rawSample from './__fixtures__/常陵.aarc-9.json'

type RawPoint = { id: number; pos: [number, number]; dir?: number; sta?: number }
type RawLine = { id: number; type?: number; isFake?: boolean; pts?: number[] }
const p = (id: number, x: number, y: number, dir: 0 | 1, station = true): AarcGeometryPoint => ({ id, x, y, dir, station })
const coords = (points: AarcGeometryPoint[]) => reconstructAarcLineGeometry(points).nodes.map(node => [node.x, node.y])
const sourcePoints = new Map((rawSample.points as unknown as RawPoint[]).map(point => [point.id, point]))
const source = (id: number): AarcGeometryPoint => { const point = sourcePoints.get(id)!; return { id, x: point.pos[0], y: point.pos[1], dir: point.dir === 1 ? 1 : 0, station: point.sta === 1 } }

function endpointFamily(point: AarcGeometryPoint): 'orthogonal' | 'diagonal' { return point.dir === 1 ? 'diagonal' : 'orthogonal' }
function legFamily(a: { x: number; y: number }, b: { x: number; y: number }): 'orthogonal' | 'diagonal' | 'invalid' {
  const kind = classifyLeg(a, b)
  return kind === 'diagonal' ? 'diagonal' : kind === 'horizontal' || kind === 'vertical' ? 'orthogonal' : 'invalid'
}

 describe('AARC dir-family edge cases', () => {
  it('keeps endpoint families on direct-illegal mixed pairs', () => {
    const cases = [
      { points: [p(149, 4450, 4825, 0), p(172, 4525, 5000, 1)], expected: [4450, 4925] },
      { points: [p(172, 4525, 5000, 1), p(174, 4600, 5200, 0)], expected: [4600, 5075] },
      { points: [p(675, 6950, 4150, 0), p(674, 6682.32233, 4207.32233, 1)], expected: [6739.64466, 4150] },
      { points: [p(674, 6682.32233, 4207.32233, 1), p(673, 6450, 4325, 0)], expected: [6564.64466, 4325] },
      { points: [p(334, 7850, 7825, 0), p(641, 7800, 7175, 1)], expected: [7850, 7225] },
    ]
    for (const item of cases) {
      const result = reconstructAarcLineGeometry(item.points)
      expect(result.nodes.map(node => [node.x, node.y])).toContainEqual(item.expected)
      const first = result.nodes[1], last = result.nodes.at(-2)!
      expect(legFamily(result.nodes[0], first)).toBe(endpointFamily(item.points[0]))
      expect(legFamily(last, result.nodes.at(-1)!)).toBe(endpointFamily(item.points[1]))
    }
  })

  it('retains the exact diagonal direct fast path', () => {
    const result = reconstructAarcLineGeometry([p(270, 2375, 4625, 1), p(161, 2525, 4475, 0)])
    expect(result.stats.directLegCount).toBe(1)
    expect(result.stats.implicitCornerCount).toBe(0)
    expect(result.nodes).toHaveLength(2)
  })

  it('uses ring context for 筱溪 closure and keeps the first pair wrapped', () => {
    const ids = [271, 318, 33, 312, 311, 310, 309, 308, 307, 210, 305, 304, 303, 302, 180, 244, 299, 298, 297, 250, 295, 294, 293, 145, 291, 290, 289, 285, 286, 284, 283, 51, 281, 280, 188, 221, 277, 276, 275, 274, 273, 272, 267, 161, 270, 271]
    const points = ids.map(source)
    const closure = reconstructAarcLineGeometry([points.at(-2)!, points.at(-1)!])
    expect(closure.nodes.map(node => [node.x, node.y])).toContainEqual([2350, 4650])
    const firstPair = reconstructAarcLineGeometry([points[0], points[1]])
    expect(firstPair.stats.directLegCount + firstPair.stats.oneImplicitReconstructionCount + firstPair.stats.twoImplicitReconstructionCount).toBe(1)
    expect(points[0].id).toBe(points.at(-1)!.id)
  })

  it('has no endpoint-family violations among direct-illegal source pairs', () => {
    const lines = rawSample.lines as unknown as RawLine[]
    let violations = 0
    for (const line of lines.filter(item => item.type === 0 && item.isFake !== true && Array.isArray(item.pts))) {
      const ids = line.pts ?? []
      for (let index = 0; index < ids.length - 1; index += 1) {
        const from = source(ids[index]), to = source(ids[index + 1])
        const result = reconstructAarcLineGeometry([from, to])
        if (result.stats.directLegCount > 0) continue
        if (result.stats.unresolvedCount > 0) { violations += 1; continue }
        const first = result.nodes[1], last = result.nodes.at(-2)!
        if (legFamily(result.nodes[0], first) !== endpointFamily(from) || legFamily(last, result.nodes.at(-1)!) !== endpointFamily(to)) violations += 1
      }
    }
    expect(violations).toBe(0)
  })

  it('keeps every implicit route monotonic without endpoint detours', () => {
    const lines = rawSample.lines as unknown as RawLine[]
    for (const line of lines.filter(item => item.type === 0 && item.isFake !== true && Array.isArray(item.pts))) {
      const ids = line.pts ?? []
      for (let index = 0; index < ids.length - 1; index += 1) {
        const from = source(ids[index]), to = source(ids[index + 1])
        const result = reconstructAarcLineGeometry([from, to])
        if (result.stats.implicitCornerCount === 0) continue
        const delta = { x: to.x - from.x, y: to.y - from.y }
        const lengthSquared = delta.x * delta.x + delta.y * delta.y
        let previous = 0
        for (const node of result.nodes) {
          const projection = ((node.x - from.x) * delta.x + (node.y - from.y) * delta.y) / lengthSquared
          expect(projection).toBeGreaterThanOrEqual(-1e-4)
          expect(projection).toBeLessThanOrEqual(1.0001)
          expect(projection + 1e-4).toBeGreaterThanOrEqual(previous)
          previous = projection
        }
      }
    }
  })
})
