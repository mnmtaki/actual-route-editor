import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { classifyLeg, reconstructAarcLineGeometry, type AarcGeometryPoint } from './aarcGeometry'
import { convertAarcToActualRouteProject } from './aarc'

type RawPoint = { id: number; pos: [number, number]; dir?: number; sta?: number }
type RawLine = { id: number; type?: number; isFake?: boolean; pts?: number[] }

const sourcePoints = new Map((rawSample.points as unknown as RawPoint[]).map(point => [point.id, point]))

function reconstructRailLines() {
  const lines = rawSample.lines as unknown as RawLine[]
  return lines
    .filter(line => line.type === 0 && line.isFake !== true && Array.isArray(line.pts))
    .map(line => {
      const points: AarcGeometryPoint[] = (line.pts ?? []).map(pointId => {
        const source = sourcePoints.get(pointId)
        if (!source) throw new Error(`Missing source point ${pointId} for line ${line.id}`)
        return { id: source.id, x: source.pos[0], y: source.pos[1], dir: source.dir === 1 ? 1 : 0, station: source.sta === 1 }
      })
      return { line, result: reconstructAarcLineGeometry(points) }
    })
}

describe('常陵 AARC rail geometry audit', () => {
  it('reconstructs every real rail line with only direct/one-/two-corner octilinear legs', () => {
    const reconstructed = reconstructRailLines()
    expect(reconstructed.length).toBeGreaterThan(0)
    const totals = reconstructed.reduce((sum, item) => {
      sum.direct += item.result.stats.directLegCount
      sum.one += item.result.stats.oneImplicitReconstructionCount
      sum.two += item.result.stats.twoImplicitReconstructionCount
      sum.unresolved += item.result.stats.unresolvedCount
      for (let index = 1; index < item.result.nodes.length; index += 1) {
        expect(classifyLeg(item.result.nodes[index - 1], item.result.nodes[index])).not.toBe('invalid')
      }
      return sum
    }, { direct: 0, one: 0, two: 0, unresolved: 0 })
    expect(totals.direct).toBeGreaterThan(0)
    expect(totals.one).toBeGreaterThan(0)
    expect(totals.two).toBeGreaterThan(0)
    expect(totals.unresolved).toBe(0)
  })

  it('keeps reconstruction deterministic for the complete fixture and importer', () => {
    const first = reconstructRailLines().map(item => item.result)
    const second = reconstructRailLines().map(item => item.result)
    expect(second).toEqual(first)
    const imported = convertAarcToActualRouteProject(rawSample, '常陵.aarc (9).json')
    expect(imported.project.lines.filter(line => line.source?.format === 'aarc')).toHaveLength(19)
    expect(imported.project.geometry.segments.every(segment => segment.waypoints.every(waypoint => waypoint.source?.format === 'aarc'))).toBe(true)
    expect(imported.project.stations.every(station => station.source?.pointId === undefined || sourcePoints.get(station.source.pointId)?.sta === 1)).toBe(true)
    for (const waypoint of imported.project.geometry.segments.flatMap(segment => segment.waypoints)) {
      const pointId = waypoint.source?.pointId
      if (pointId === undefined) continue
      const source = sourcePoints.get(pointId)
      expect(source?.sta).toBe(0)
      expect([waypoint.x, waypoint.y]).toEqual(source?.pos)
    }
  })
})
