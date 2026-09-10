import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getPassengerStationCount, getPassengerStationCountForLine } from './passengerStats'
import rawPinglan from '../import-export/__fixtures__/平岚.aarc (9).json'
import { convertAarcToActualRouteProject } from '../import-export/aarc'

describe('passenger station statistics', () => {
  it('deduplicates compound members while retaining concrete line scope', () => {
    const project = structuredClone(demoProject)
    const station = project.stations.find(item => item.id === 's2')!
    station.compoundGroupId = 'civic'
    project.stations.push({ ...station, id: 's2-aux', name: '辅助成员', compoundGroupId: 'civic' })
    project.stationLineRelations.push({ id: 'r-a-s2-aux', stationId: 's2-aux', lineId: 'line-a', openedAt: '2000-01-01' })
    expect(getPassengerStationCount(project)).toBe(getPassengerStationCount(demoProject))
    expect(getPassengerStationCountForLine(project, 'line-a')).toBe(getPassengerStationCountForLine(demoProject, 'line-a'))
  })


  it('locks the Pinglan fixture to geometric 537 and passenger 535 stations', () => {
    const { project } = convertAarcToActualRouteProject(rawPinglan, '平岚.aarc (9).json')
    expect(project.stations).toHaveLength(537)
    expect(getPassengerStationCount(project)).toBe(535)
    const line2 = project.lines.find(line => line.name === '2号线')!
    expect(getPassengerStationCountForLine(project, line2.id)).toBe(24)
  })
  it('does not merge sibling branch relations into the parent line scope', () => {
    const project = structuredClone(demoProject)
    const branch = { ...project.lines[0], id: 'line-a-branch', name: '澄川支线', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3 }
    project.lines.push(branch)
    project.stationLineRelations.push({ id: 'r-branch-s5', stationId: 's5', lineId: branch.id, openedAt: '2000-01-01' })
    expect(getPassengerStationCountForLine(project, branch.id)).toBe(1)
    expect(getPassengerStationCountForLine(project, 'line-a')).toBe(getPassengerStationCountForLine(demoProject, 'line-a'))
  })
})
