import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from './aarc'
import {
  AARC_STATION_SNAP_DISTANCE,
  buildAarcStationComponents,
  readAarcExplicitClusterLinks,
  resolveAarcStationName,
  type AarcStationPointInput,
} from './aarcStationClustering'

const point = (id: number, x: number, y: number, sourceOrder = id, name?: string): AarcStationPointInput => ({ id, x, y, sourceOrder, ...(name ? { name } : {}) })

describe('AARC station connectivity graph', () => {
  it('uses AARC clinging distance and epsilon*10 tolerance', () => {
    const result = buildAarcStationComponents([
      point(1, 0, 0),
      point(2, AARC_STATION_SNAP_DISTANCE + 0.0005, 0),
      point(3, 0, 100),
      point(4, AARC_STATION_SNAP_DISTANCE + 0.01, 100),
    ], new Map([[1, [10]], [2, [11]], [3, [10]], [4, [11]]]))
    expect(result.components.find(component => component.pointIds.includes(1))?.pointIds).toEqual([1, 2])
    expect(result.components.find(component => component.pointIds.includes(3))?.pointIds).toEqual([3])
    expect(result.components.find(component => component.pointIds.includes(4))?.pointIds).toEqual([4])
  })

  it('scales automatic clinging distance by the average station snap size', () => {
    const points = [point(1, 0, 0), point(2, 40, 0)]
    const memberships = new Map([[1, [10]], [2, [11]]])
    expect(buildAarcStationComponents(points, memberships, { getSnapSize: () => 1 }).components).toHaveLength(2)
    expect(buildAarcStationComponents(points, memberships, { getSnapSize: () => 2 }).components[0]?.pointIds).toEqual([1, 2])
  })

  it('forms one connected component through transitive proximity', () => {
    const result = buildAarcStationComponents(
      [point(1, 0, 0), point(2, 20, 0), point(3, 40, 0)],
      new Map([[1, [10]], [2, []], [3, [11]]]),
    )
    expect(result.components).toHaveLength(1)
    expect(result.components[0]).toMatchObject({ pointIds: [1, 2, 3], referencedPointIds: [1, 3], helperPointIds: [2] })
  })

  it('does not add pointLinks to the automatic cluster graph', () => {
    const points = [point(1, 0, 0), point(2, 200, 0)]
    const memberships = new Map([[1, [10]], [2, [11]]])
    const result = buildAarcStationComponents(points, memberships, [{ pts: [1, 2], type: 4 }], {})
    expect(result.components).toHaveLength(2)
    expect(result.edges).toHaveLength(0)
  })

  it('reads only type=4 pointLinks as explicit forced-interchange links', () => {
    const warnings: string[] = []
    const edges = readAarcExplicitClusterLinks([
      { pts: [1, 2], type: 4 },
      { pts: [2, 3], type: 0 },
      { pts: [3, 4], type: 2 },
      { pts: [1, 999], type: 4 },
    ], new Set([1, 2, 3, 4]), warnings)
    expect(edges.map(edge => [edge.a, edge.b])).toEqual([[1, 2]])
    expect(warnings).toHaveLength(1)
  })

  it('compares every free snap candidate from A with every candidate from B', () => {
    const points = [
      { ...point(1, 0, 0), free: true },
      { ...point(2, 100, 0), free: true },
    ]
    const memberships = new Map([[1, [10]], [2, [11]]])
    const candidates = (candidatePoint: AarcStationPointInput) => candidatePoint.id === 1
      ? { candidates: [[0, 0], [50, 0]] as Array<[number, number]> }
      : { candidates: [[100, 0], [50, 0]] as Array<[number, number]> }
    const result = buildAarcStationComponents(points, memberships, {
      configClingingDist: 25,
      getSnapSize: () => 1,
      getSnapCandidates: candidates,
    })
    expect(result.components).toHaveLength(1)
    expect(result.components[0].pointIds).toEqual([1, 2])
  })

  it('uses any pointLink type only for AARC fallback station-name lookup', () => {
    const points = [
      point(1, 0, 0, 0),
      point(2, 10, 0, 1),
      point(3, 200, 0, 2, '远端站名'),
    ]
    const memberships = new Map([[1, [10]], [2, [10]], [3, [11]]])
    const automatic = buildAarcStationComponents(points, memberships)
    const resolved = resolveAarcStationName(1, points, [{ pts: [2, 3], type: 0 }], automatic.components)
    expect(resolved).toEqual({ name: '远端站名', nameSub: '', pointId: 3 })
    expect(automatic.components.find(component => component.pointIds.includes(1))?.pointIds).toEqual([1, 2])
    expect(automatic.components.find(component => component.pointIds.includes(3))?.pointIds).toEqual([3])
  })

  it('keeps the 常陵 fixture automatic-cluster audit stable', () => {
    const { project, summary } = convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
    const stationByName = (name: string) => project.stations.find(station => station.name === name)!
    const relationNames = (name: string) => project.stationLineRelations.filter(relation => relation.stationId === stationByName(name).id).map(relation => project.lines.find(line => line.id === relation.lineId)?.name).sort()
    expect(relationNames('回盛')).toEqual(['17', '6'])
    expect(relationNames('理场院')).toEqual(['19', '3'])
    expect(relationNames('小麦市')).toEqual(['19', '3', '4'])
    expect(relationNames('如意桥')).toEqual(['1', '19', '3'])
    expect(relationNames('稻香楼')).toEqual(['1', '4'])
    expect(relationNames('清樽路')).toEqual(['18', '4', '6'])
    expect(summary.stationCount).toBe(project.stations.length)

    const points = (rawSample.points as unknown as Array<{ id: number; pos: [number, number]; sta: number; name?: string; nameS?: string; nameP?: [number, number] }>)
      .filter(item => item.sta === 1)
      .map((item, sourceOrder) => ({ id: item.id, x: item.pos[0], y: item.pos[1], sourceOrder, ...(item.name ? { name: item.name } : {}), ...(item.nameS ? { nameS: item.nameS } : {}), ...(item.nameP ? { nameP: item.nameP } : {}) }))
    const lines = (rawSample.lines as unknown as Array<{ id: number; name?: string; type?: number; isFake?: boolean; pts?: number[] }>).filter(line => line.isFake !== true && line.type !== 1 && line.name && Array.isArray(line.pts))
    const memberships = new Map<number, number[]>()
    for (const line of lines) for (const pointId of line.pts!) if (points.some(item => item.id === pointId)) memberships.set(pointId, [...new Set([...(memberships.get(pointId) ?? []), line.id])])
    const audit = buildAarcStationComponents(points, memberships)
    expect(audit.metrics).toEqual({ sta1Total: 465, referencedSta1Count: 463, helperCount: 2, proximityEdgeCount: 29, multiPointComponentCount: 24, interchangeStationCount: 126, helperOnlyComponentCount: 0, ambiguousNameCount: 0 })
  })
})
