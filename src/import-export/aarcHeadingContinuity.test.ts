import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from './aarc'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from './aarcGeometry'
import { getSegmentPoints } from '../geometry/path'

type RawPoint = { id: number; pos: [number, number]; dir?: number; sta?: number }
type RawLine = { id: number; name?: string; type?: number; isFake?: boolean; pts?: number[] }
const sourcePoints = new Map((rawSample.points as unknown as RawPoint[]).map(point => [point.id, point]))
const source = (id: number): AarcGeometryPoint => {
  const point = sourcePoints.get(id)
  if (!point) throw new Error(`Missing fixture point ${id}`)
  return { id, x: point.pos[0], y: point.pos[1], dir: point.dir === 1 ? 1 : 0, station: point.sta === 1 }
}
const coords = (points: AarcGeometryPoint[]) => reconstructAarcLineGeometry(points).nodes.map(node => [node.x, node.y])
const concreteHeading = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, epsilon = 1e-4
  if (Math.abs(dy) < epsilon) return dx > 0 ? 'E' : 'W'
  if (Math.abs(dx) < epsilon) return dy > 0 ? 'S' : 'N'
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) < epsilon) {
    if (dx > 0) return dy > 0 ? 'NE' : 'SE'
    return dy > 0 ? 'NW' : 'SW'
  }
  return null
}
const subpathBetween = (points: AarcGeometryPoint[], fromIndex: number, toIndex: number) => {
  const nodes = reconstructAarcLineGeometry(points).nodes
  const fromNode = nodes.findIndex(node => node.sourcePointIndex === fromIndex)
  const toNode = nodes.findIndex(node => node.sourcePointIndex === toIndex)
  if (fromNode < 0 || toNode < 0) throw new Error('source node not found')
  return nodes.slice(fromNode, toNode + 1)
}

describe('AARC heading continuity reconstruction', () => {
  it('keeps the real 凑桥 two-implicit bridge in full source context', () => {
    const points = [812, 156, 256, 672, 816].map(source)
    const result = reconstructAarcLineGeometry(points)
    const pair = subpathBetween(points, 1, 2)
    expect(pair.map(node => [node.x, node.y])).toEqual([[6450, 4825], [6400, 4775], [6400, 4625], [6350, 4575]])
    expect(result.stats.twoImplicitReconstructionCount).toBeGreaterThanOrEqual(1)
  })

  it('keeps 小枕湾—长歇塘 free of the former left-side reversal', () => {
    const points = [508, 511, 512, 273].map(source)
    const pair = subpathBetween(points, 1, 2)
    expect(pair.filter(node => node.implicit)).toHaveLength(1)
    expect(pair.find(node => node.implicit)!.x).toBeGreaterThan(points[1].x)
    expect(concreteHeading(points[0], points[1])).toBe(concreteHeading(pair[0], pair[1]))
    expect(concreteHeading(pair.at(-2)!, pair.at(-1)!)).toBe(concreteHeading(points[2], points[3]))
  })

  it('keeps the airport route in the real importer-to-segment pipeline', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
    const airport = project.stations.find(station => station.source?.pointId === 334)
    const luming = project.stations.find(station => station.source?.pointId === 641)
    const line = project.lines.find(item => item.name === '18')
    const segment = project.geometry.segments.find(item => item.lineId === line?.id && item.fromStationId === airport?.id && item.toStationId === luming?.id)
    expect(segment).toBeDefined()
    expect(getSegmentPoints(project, segment!).map(point => [point.x, point.y])).toEqual([
      [7850, 7825],
      [7850, 7225],
      [7800, 7175],
    ])
  })

  it.each([
    ['orthogonal-to-diagonal', { id: 1, x: 0, y: 0, dir: 0, station: true }, { id: 2, x: 100, y: 250, dir: 1, station: true }],
    ['diagonal-to-orthogonal', { id: 1, x: 0, y: 0, dir: 1, station: true }, { id: 2, x: 100, y: 250, dir: 0, station: true }],
    ['diagonal-to-diagonal-one', { id: 1, x: 0, y: 0, dir: 1, station: true }, { id: 2, x: 100, y: 250, dir: 1, station: true }],
  ] as Array<[string, AarcGeometryPoint, AarcGeometryPoint]>)('is reverse invariant for %s', (_name, from, to) => {
    const forward = coords([from, to])
    const reverse = coords([{ ...to, id: 3 }, { ...from, id: 4 }])
    expect(reverse).toEqual(forward.slice().reverse())
  })

  it('is reverse invariant for a diagonal two-implicit context', () => {
    const forwardPoints = [source(812), source(156), source(256), source(672)]
    const reversePoints = forwardPoints.slice().reverse().map((point, index) => ({ ...point, id: 1000 + index }))
    expect(coords(reversePoints)).toEqual(coords(forwardPoints).slice().reverse())
  })

  it('locks the Build60 two-to-one audit as a structured fingerprint', () => {
    const expected = new Map([
      ['173:149:172', [[4450, 4925]]], ['173:172:174', [[4600, 5075]]],
      ['236:697:39', [[1450, 6350]]], ['236:39:695', [[1550, 6450]]],
      ['536:545:543', [[4950, 3375]]], ['536:543:224', [[4825, 3250]]],
      ['659:675:674', [[6739.64466, 4150]]], ['659:674:673', [[6564.64466, 4325]]],
      ['704:723:722', [[4100, 1775]]], ['704:722:702', [[4425, 2100]]],
      ['795:812:156', [[6625, 5000]]], ['795:256:672', [[6200, 4425]]],
      ['795:156:256', [[6400, 4775], [6400, 4625]]],
    ])
    for (const [key, implicit] of expected) {
      const [lineId, fromId, toId] = key.split(':').map(Number)
      const line = (rawSample.lines as unknown as RawLine[]).find(item => item.id === lineId)!
      const points = (line.pts ?? []).map(source)
      const fromIndex = points.findIndex((point, index) => point.id === fromId && points[index + 1]?.id === toId)
      expect(fromIndex).toBeGreaterThanOrEqual(0)
      expect(subpathBetween(points, fromIndex, fromIndex + 1).slice(1, -1).map(node => [node.x, node.y])).toEqual(implicit)
    }
  })

  it('keeps all real fixture lines octilinear with no unresolved pair', () => {
    const lines = rawSample.lines as unknown as RawLine[]
    let direct = 0, one = 0, two = 0, unresolved = 0
    for (const line of lines.filter(item => item.type === 0 && item.isFake !== true && Array.isArray(item.pts))) {
      const points = (line.pts ?? []).map(source)
      const result = reconstructAarcLineGeometry(points)
      direct += result.stats.directLegCount
      one += result.stats.oneImplicitReconstructionCount
      two += result.stats.twoImplicitReconstructionCount
      unresolved += result.stats.unresolvedCount
    }
    expect({ direct, one, two, unresolved }).toEqual({ direct: 518, one: 67, two: 6, unresolved: 0 })
  })
})
