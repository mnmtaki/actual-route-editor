import { describe, expect, it } from 'vitest'
import rawPinglan from './__fixtures__/平岚.aarc (9).json'
import { convertAarcToActualRouteProject } from './aarc'
import { detectAarcCompoundGroups, AARC_COMPOUND_DISTANCE } from './aarcCompoundStations'
import { getPassengerLinesAtStation } from '../timeline/active'
import { getCompoundStationMembers, isCompoundStationCanonical, getPassengerStationIdentity } from '../data/compoundStation'
import { parseProjectJson, serializeProject } from './projectJson'
import { sortTransferLinesForSpatialOrder } from '../geometry/transferOrdering'

describe('AARC compound interchange detection', () => {
  it('uses automatic AARC station proximity without old same-line/name/family business rules', () => {
    const points = [
      { id: 1, x: 0, y: 0, sta: 1, name: 'A' },
      { id: 2, x: AARC_COMPOUND_DISTANCE, y: 0, sta: 1 },
      { id: 3, x: 100, y: 0, sta: 1, name: 'C' },
    ]
    const lines = [{ id: 10, pts: [1, 3] }, { id: 20, pts: [2, 3] }]
    const memberships = new Map([[1, [10]], [2, [20]], [3, [10, 20]]])
    const result = detectAarcCompoundGroups(points, lines, memberships)
    expect(result.groups.map(group => group.pointIds)).toEqual([[1, 2]])
    expect(result.groups[0].edges[0].reason).toBe('proximity')
  })

  it('keeps a chain of automatically clinging stations in one stable passenger group', () => {
    const points = [1, 2, 3].map((id, index) => ({ id, x: index * 20, y: 0, sta: 1 }))
    const lines = [{ id: 10, pts: [1, 2, 3] }]
    const memberships = new Map([[1, [10, 20]], [2, [10, 21]], [3, [10, 22]]])
    expect(detectAarcCompoundGroups(points, lines, memberships).groups[0]?.pointIds).toEqual([1, 2, 3])
  })

  it('maps an explicit AARC type=4 cluster link to a forced passenger interchange even when stations are far apart', () => {
    const points = [{ id: 1, x: 0, y: 0, sta: 1 }, { id: 2, x: 500, y: 0, sta: 1 }]
    const memberships = new Map([[1, [10]], [2, [20]]])
    const result = detectAarcCompoundGroups(points, [], memberships, { pointLinks: [{ pts: [1, 2], type: 4 }] })
    expect(result.groups[0]?.pointIds).toEqual([1, 2])
    expect(result.groups[0]?.edges).toEqual([expect.objectContaining({ a: 1, b: 2, reason: 'explicit-cluster-link' })])
  })

  it('does not turn ordinary fat/thin/dot pointLinks into passenger interchanges', () => {
    const points = [{ id: 1, x: 0, y: 0, sta: 1 }, { id: 2, x: 500, y: 0, sta: 1 }]
    const memberships = new Map([[1, [10]], [2, [20]]])
    for (const type of [0, 1, 2, 3]) {
      expect(detectAarcCompoundGroups(points, [], memberships, { pointLinks: [{ pts: [1, 2], type }] }).groups).toEqual([])
    }
  })

  it('imports 平岚 1239/921 as one passenger station without changing source geometry', () => {
    const { project } = convertAarcToActualRouteProject(rawPinglan, '平岚.aarc (9).json')
    const named = project.stations.find(station => station.source?.pointId === 1239)!
    const auxiliary = project.stations.find(station => station.source?.pointId === 921)!
    expect(named).toMatchObject({ x: 3275, y: 3850, name: '王家沟', nameS: 'Wangjiagou' })
    expect(auxiliary).toMatchObject({ x: 3300, y: 3850 })
    expect(named.compoundGroupId).toBeTruthy()
    expect(auxiliary.compoundGroupId).toBe(named.compoundGroupId)
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.stations.find(station => station.source?.pointId === 921)?.compoundGroupId).toBe(named.compoundGroupId)
    expect(getCompoundStationMembers(project, named).map(station => station.source?.pointId)).toEqual([921, 1239])
    expect(isCompoundStationCanonical(project, named)).toBe(true)
    expect(isCompoundStationCanonical(project, auxiliary)).toBe(false)
    expect(getPassengerStationIdentity(project, named)).toBe(getPassengerStationIdentity(project, auxiliary))
    expect(new Set(project.stations.flatMap(station => station.compoundGroupId ? [station.compoundGroupId] : []))).toEqual(new Set(['aarc-compound-297-925', 'aarc-compound-921-1239']))
    const passengerLines = getPassengerLinesAtStation(project, named.id, '9999-12-31')
    expect(passengerLines.map(line => line.name).sort()).toEqual(['12号线', '14号线', '2号线'])
    expect(sortTransferLinesForSpatialOrder(project, named.id, passengerLines, '9999-12-31').map(line => line.name)).toEqual(['14号线', '2号线', '12号线'])
    const line2 = project.lines.find(line => line.name === '2号线')!
    const segment = project.geometry.segments.find(item => item.lineId === line2.id && item.fromStationId === named.id && item.toStationId === auxiliary.id) ?? project.geometry.segments.find(item => item.lineId === line2.id && item.fromStationId === auxiliary.id && item.toStationId === named.id)
    expect(segment).toBeTruthy()
    expect([named.x, named.y, auxiliary.x, auxiliary.y]).toEqual([3275, 3850, 3300, 3850])
  })
})
