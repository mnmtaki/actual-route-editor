import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from './aarc'
import { getStationAnchorForLine, translateStationWithAnchors } from '../data/stationAnchor'
import { getSegmentPathSpans } from '../geometry/path'
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

  it('keeps an original AARC station corner sharp instead of rounding across Segment boundaries', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
    const station = project.stations.find(item => item.source?.pointId === 44)
    expect(station).toBeDefined()

    const lineId = 'aarc-line-11'
    const incident = project.geometry.segments.filter(segment =>
      segment.lineId === lineId && (segment.fromStationId === station!.id || segment.toStationId === station!.id),
    )
    expect(incident).toHaveLength(2)

    const anchor = getStationAnchorForLine(project, station!.id, lineId)!
    expect(anchor).toEqual({ x: 5200, y: 5575 })

    for (const segment of incident) {
      const spans = getSegmentPathSpans(project, segment, lineId)
      expect(spans.length).toBeGreaterThan(0)
      const boundary = segment.fromStationId === station!.id ? spans[0].start : spans.at(-1)!.end
      expect(boundary).toEqual(anchor)
    }
  })

  it('keeps a moved AARC station as a sharp segment boundary instead of rounding around it', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
    const station = project.stations.find(item => item.source?.pointId === 407)
    expect(station).toBeDefined()

    const lineId = 'aarc-line-322'
    const incident = project.geometry.segments.filter(segment =>
      segment.lineId === lineId && (segment.fromStationId === station!.id || segment.toStationId === station!.id),
    )
    expect(incident).toHaveLength(2)

    translateStationWithAnchors(project, station!.id, 80, 0)
    const moved = getStationAnchorForLine(project, station!.id, lineId)!
    expect(moved).toEqual({ x: 4280, y: 4325 })

    for (const segment of incident) {
      const spans = getSegmentPathSpans(project, segment, lineId)
      expect(spans.length).toBeGreaterThan(0)
      const boundary = segment.fromStationId === station!.id ? spans[0].start : spans.at(-1)!.end
      expect(boundary).toEqual(moved)
    }
  })

  it('keeps a helper sta point inside a transitive automatic proximity cluster', () => {
    const point = (id: number, x: number, y: number, sourceOrder = id): AarcStationPointInput => ({ id, x, y, sourceOrder })
    const result = buildAarcStationComponents(
      [point(1, 0, 0), point(2, 24, 0), point(3, 48, 0)],
      new Map([[1, [10]], [2, []], [3, [10]]]),
    )
    expect(result.components).toHaveLength(1)
    expect(result.components[0].pointIds).toEqual([1, 2, 3])
    expect(result.components[0].referencedPointIds).toEqual([1, 3])
    expect(result.components[0].helperPointIds).toEqual([2])
  })
})
