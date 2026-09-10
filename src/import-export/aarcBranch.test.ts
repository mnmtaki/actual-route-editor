import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/平岚.aarc (9).json'
import { convertAarcToActualRouteProject } from './aarc'
import { areLinesSameServiceFamily, getEffectiveLineColor, getLineDisplayName } from '../data/lineIdentity'

describe('AARC 支线导入', () => {
  it('preserves the real 19号线 parent and unnamed branch as independent topology', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '平岚.aarc (9).json')
    const main = project.lines.find(line => line.source?.lineId === 1273)
    const branch = project.lines.find(line => line.source?.lineId === 1294)
    expect(main).toBeTruthy()
    expect(branch).toBeTruthy()
    expect(main?.name).toBe('19号线')
    expect(branch?.name).toBe('')
    expect(branch?.parentLineId).toBe(main?.id)
    expect(branch?.source?.sourceColor).toBeTruthy()
    expect(branch?.source?.sourceWidthRatio).toBeGreaterThan(0)
    expect(branch && project.geometry.segments.some(segment => segment.lineId === branch.id)).toBe(true)
    expect(branch && project.stationLineRelations.some(relation => relation.lineId === branch.id)).toBe(true)
    const shared = project.stations.find(station => station.source?.pointIds?.includes(1297))
    expect(shared).toBeTruthy()
    expect(project.stationLineRelations.filter(relation => relation.stationId === shared?.id).map(relation => relation.lineId)).toEqual(expect.arrayContaining([main?.id, branch?.id]))
  })

  it('treats main and branch as one passenger service family while keeping inherited color and display name', () => {
    const { project } = convertAarcToActualRouteProject(rawSample, '平岚.aarc (9).json')
    const main = project.lines.find(line => line.source?.lineId === 1273)!
    const branch = project.lines.find(line => line.source?.lineId === 1294)!
    expect(areLinesSameServiceFamily(project, main, branch)).toBe(true)
    expect(getEffectiveLineColor(project, branch)).toBe(getEffectiveLineColor(project, main))
    expect(getLineDisplayName(project, branch)).toBe('支线')
  })
})
