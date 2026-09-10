import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from './aarc'
import { getStationAnchorForLine } from '../data/stationAnchor'
import { buildAarcStationComponents, type AarcStationPointInput } from './aarcStationClustering'

describe('AARC per-line station occurrence anchors', () => {
  it('keeps every source station occurrence at its original position', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
    const points = new Map((rawSample.points as unknown as Array<{ id: number; pos: [number, number]; sta: number }>).map(point => [point.id, point]))
    const lines = (rawSample.lines as Array<{ id: number; type?: number; isFake?: boolean; pts?: unknown }>).filter(line => line.isFake !== true && line.type !== 1 && Array.isArray(line.pts))
    let occurrences = 0
    for (const rawLine of lines) {
      const lineId = `aarc-line-${rawLine.id}`
      for (const rawId of rawLine.pts as unknown[]) {
        const pointId = Number(rawId), point = points.get(pointId)
        if (!point || point.sta !== 1) continue
        const station = project.stations.find(item => item.source?.pointIds?.includes(pointId))
        expect(station).toBeDefined()
        const relation = project.stationLineRelations.find(item => item.stationId === station!.id && item.lineId === lineId)
        expect(relation).toBeDefined()
        expect(getStationAnchorForLine(project, station!.id, lineId)).toEqual({ x: point.pos[0], y: point.pos[1] })
        occurrences += 1
      }
    }
    expect(occurrences).toBe(589)
    expect(project.stationLineRelations.filter(relation => relation.anchor).length).toBe(30)
    expect(project.stations).toHaveLength(437)
  })

  it('follows AARC pointLinks transitively without a same-line business veto', () => {
    const point = (id: number, x: number, y: number, sourceOrder = id): AarcStationPointInput => ({ id, x, y, sourceOrder })
    const result = buildAarcStationComponents(
      [point(1, 0, 0), point(2, 24, 0), point(3, 48, 0)],
      new Map([[1, [10]], [2, []], [3, [10]]]),
      [{ pts: [1, 2, 3] }],
    )
    expect(result.components).toHaveLength(1)
    expect(result.components[0].referencedPointIds).toEqual([1, 3])
    expect(result.warnings).toEqual([])
  })
})
