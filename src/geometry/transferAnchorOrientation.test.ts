import { describe, expect, it } from 'vitest'
import rawSample from '../import-export/__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { getTransferMarkerLayout } from './tangent'

const imported = () => convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json').project
const stationByName = (name: string) => {
  const project = imported()
  const station = project.stations.find(item => item.name === name)
  if (!station) throw new Error(`missing station ${name}`)
  return { project, station }
}

describe('transfer orientation from relation anchors', () => {
  it.each([
    ['中塔', 90],
    ['清樽路', 90],
    ['南城公园', 0],
    ['稻香楼', 90],
  ])('%s uses the spatial anchor span (%s degrees)', (name, expected) => {
    const { project, station } = stationByName(name)
    expect(getTransferMarkerLayout(project, station.id, '2025-01-01').rotation).toBeCloseTo(expected, 5)
  })

  it('is independent of relation ordering and treats 180-degree flips as the same axis', () => {
    const { project, station } = stationByName('稻香楼')
    const before = getTransferMarkerLayout(project, station.id, '2025-01-01').rotation
    project.stationLineRelations.reverse()
    const after = getTransferMarkerLayout(project, station.id, '2025-01-01').rotation
    expect(after).toBeCloseTo(before, 5)
  })

  it('falls back deterministically when all resolved anchors coincide', () => {
    const { project, station } = stationByName('清樽路')
    const relations = project.stationLineRelations.filter(relation => relation.stationId === station.id)
    for (const relation of relations) relation.anchor = undefined
    const first = getTransferMarkerLayout(project, station.id, '2025-01-01').rotation
    project.stationLineRelations.reverse()
    const second = getTransferMarkerLayout(project, station.id, '2025-01-01').rotation
    expect(second).toBeCloseTo(first, 5)
  })
})
