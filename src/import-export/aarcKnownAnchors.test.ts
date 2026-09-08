import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/常陵.aarc-9.json'
import { convertAarcToActualRouteProject } from './aarc'

const importedResult = () => convertAarcToActualRouteProject(rawSample, '常陵.aarc-9.json')
const imported = () => importedResult().project
const relationAnchor = (project: ReturnType<typeof imported>, name: string, lineName: string) => {
  const station = project.stations.find(item => item.name === name)!
  const line = project.lines.find(item => item.name === lineName)!
  return project.stationLineRelations.find(item => item.stationId === station.id && item.lineId === line.id)?.anchor
}

describe('常陵 AARC known line anchors', () => {
  it('restores non-canonical occurrence coordinates without duplicating logical stations', () => {
    const project = imported()
    expect(relationAnchor(project, '清樽路', '4')).toBeUndefined()
    expect(relationAnchor(project, '清樽路', '6')).toBeUndefined()
    expect(relationAnchor(project, '清樽路', '18')).toEqual({ x: 5350, y: 5675 })
    expect(relationAnchor(project, '回盛', '6')).toBeUndefined()
    expect(relationAnchor(project, '回盛', '17')).toEqual({ x: 6682.32233, y: 4207.32233 })
    expect(relationAnchor(project, '理场院', '19')).toEqual({ x: 4625, y: 5200 })
    expect(relationAnchor(project, '小麦市', '19')).toEqual({ x: 4625, y: 5400 })
    expect(relationAnchor(project, '如意桥', '19')).toEqual({ x: 4625, y: 5700 })
    expect(relationAnchor(project, '稻香楼', '17')).toEqual({ x: 5175, y: 5550 })
    expect(project.geometry.segments).toHaveLength(570)
    // Endpoint dir-family validation removes 13 legacy, family-inconsistent implicit nodes; source coordinates and topology remain unchanged.
    expect(project.geometry.segments.flatMap(segment => segment.waypoints)).toHaveLength(97)
    const summary = importedResult().summary
    expect(summary.explicitWaypointCount).toBe(21)
    expect(summary.implicitCornerCount).toBe(76)
    expect(project.stations).toHaveLength(436)
  })
})
