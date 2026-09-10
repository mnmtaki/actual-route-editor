import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from './aarc'
import { AARC_STATION_SNAP_DISTANCE, buildAarcStationComponents, type AarcStationPointInput } from './aarcStationClustering'

const point = (id: number, x: number, y: number, sourceOrder = id, name?: string): AarcStationPointInput => ({ id, x, y, sourceOrder, ...(name ? { name } : {}) })

describe('AARC station connectivity graph', () => {
  it('uses the exact snap threshold with a small floating-point epsilon', () => {
    const result = buildAarcStationComponents([
      point(1, 0, 0), point(2, AARC_STATION_SNAP_DISTANCE + 0.00001, 0), point(3, 0, 100), point(4, 25.1, 100),
    ], new Map([[1, [10]], [2, [11]], [3, [10]], [4, [11]]]), [])
    expect(result.components.find(component => component.pointIds.includes(1))?.pointIds).toEqual([1, 2])
    expect(result.components.find(component => component.pointIds.includes(3))?.pointIds).toEqual([3])
    expect(result.components.find(component => component.pointIds.includes(4))?.pointIds).toEqual([4])
  })

  it('supports explicit cluster pointLinks and transitive helper bridges without materializing helper-only components', () => {
    const result = buildAarcStationComponents([
      point(10, 0, 0, 0, '主站'), point(11, 25, 0), point(12, 50, 0), point(13, 500, 0),
    ], new Map([[10, [1]], [12, [2]]]), [{ pts: [10, 11], type: 4 }, { pts: [11, 12], type: 4 }])
    expect(result.components).toEqual([
      expect.objectContaining({ pointIds: [10, 11, 12], referencedPointIds: [10, 12], helperPointIds: [11], lineIds: [1, 2], canonicalPointId: 10 }),
    ])
    expect(result.components.some(component => component.pointIds.includes(13))).toBe(false)
    expect(result.metrics.helperOnlyComponentCount).toBe(1)
  })

  it('does not treat fat/thin/dot visual links as station clusters', () => {
    const result = buildAarcStationComponents([
      point(1, 0, 0, 0, '甲'), point(2, 100, 0, 1, '乙'),
    ], new Map([[1, [10]], [2, [11]]]), [{ pts: [1, 2], type: 1 }])
    expect(result.components).toHaveLength(2)
    expect(result.metrics.pointLinksEdgeCount).toBe(0)
  })

  it('warns for invalid pointLinks without dropping valid station connections', () => {
    const result = buildAarcStationComponents([point(1, 0, 0), point(2, 100, 0)], new Map([[1, [1]], [2, [2]]]), [{ pts: [1, 999, 2], type: 4 }])
    expect(result.components).toHaveLength(1)
    expect(result.warnings).toEqual([expect.stringContaining('999')])
  })

  it('merges the complete 常陵 interchange fixture through proximity, pointLinks and shared ids', () => {
    const { project, summary } = convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
    const stationByName = (name: string) => project.stations.find(station => station.name === name)!
    const relationNames = (name: string) => project.stationLineRelations.filter(relation => relation.stationId === stationByName(name).id).map(relation => project.lines.find(line => line.id === relation.lineId)?.name).sort()
    expect(relationNames('回盛')).toEqual(['17', '6'])
    expect(relationNames('理场院')).toEqual(['19', '3'])
    expect(relationNames('小麦市')).toEqual(['19', '3', '4'])
    expect(relationNames('如意桥')).toEqual(['1', '19', '3'])
    expect(relationNames('稻香楼')).toEqual(['1', '4'])
    expect(relationNames('清樽路')).toEqual(['18', '4', '6'])
    expect(project.stations.some(station => station.source?.pointId === 649)).toBe(false)
    expect(project.stationLineRelations.some(relation => relation.stationId === 'aarc-station-649')).toBe(false)
    expect(project.geometry.segments.some(segment => segment.waypoints.some(waypoint => waypoint.source?.pointId === 649))).toBe(false)
    expect(summary.stationCount).toBe(project.stations.length)
    expect(summary.stationCount).toBe(437)
    expect(new Set(project.stationLineRelations.filter(relation => project.stationLineRelations.filter(item => item.stationId === relation.stationId).length > 1).map(relation => relation.stationId)).size).toBe(126)

    const points = (rawSample.points as unknown as Array<{ id: number; pos: [number, number]; sta: number; name?: string; nameS?: string; nameP?: [number, number] }>)
      .filter(point => point.sta === 1).map((point, sourceOrder) => ({ id: point.id, x: point.pos[0], y: point.pos[1], sourceOrder, ...(point.name ? { name: point.name } : {}), ...(point.nameS ? { nameS: point.nameS } : {}), ...(point.nameP ? { nameP: point.nameP } : {}) }))
    const lines = (rawSample.lines as unknown as Array<{ id: number; name?: string; type?: number; isFake?: boolean; pts?: number[] }>).filter(line => line.isFake !== true && line.type !== 1 && line.name && Array.isArray(line.pts))
    const memberships = new Map<number, number[]>()
    for (const line of lines) for (const pointId of line.pts!) if (points.some(point => point.id === pointId)) memberships.set(pointId, [...new Set([...(memberships.get(pointId) ?? []), line.id])])
    const audit = buildAarcStationComponents(points, memberships, rawSample.pointLinks)
    expect(audit.metrics).toEqual({ sta1Total: 465, referencedSta1Count: 463, helperCount: 2, proximityEdgeCount: 29, pointLinksEdgeCount: 0, multiPointComponentCount: 24, interchangeStationCount: 126, helperOnlyComponentCount: 0, ambiguousNameCount: 0 })
  })
})
