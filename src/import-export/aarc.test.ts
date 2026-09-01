import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/木阳.aarc.json'
import { convertAarcToActualRouteProject } from './aarc'
import { detectProjectFormat } from './detectProjectFormat'
import { parseProjectJson, serializeProject } from './projectJson'

const imported = () => convertAarcToActualRouteProject(rawSample, '木阳.aarc.json')

describe('AARC importer with the real 木阳 sample', () => {
  it('detects native and AARC formats before conversion', () => {
    expect(detectProjectFormat(rawSample)).toBe('aarc')
    expect(detectProjectFormat(imported().project)).toBe('actual-route')
  })

  it('imports only the four real lines and ignores helper artwork', () => {
    const { project, summary } = imported()
    expect(project.lines.map(line => line.name)).toEqual(['1', '3', '4', '6'])
    expect(summary.realLineCount).toBe(4)
    expect(summary.ignoredHelperCount).toBe(23)
    expect(project.lines.every(line => line.source?.format === 'aarc')).toBe(true)
  })

  it('preserves AARC world coordinates and bilingual names exactly', () => {
    const { project } = imported()
    expect(project.stations.find(station => station.source?.pointId === 6)).toMatchObject({ name: '五岔', nameS: 'Wucha', x: 5250, y: 4750, labelOffsetX: 16.2, labelOffsetY: 0 })
    expect(project.stations.find(station => station.source?.pointId === 60)).toMatchObject({ name: '楚阳街', nameS: 'Chuyang Street', x: 5250, y: 5000 })
    expect(project.stations.find(station => station.source?.pointId === 83)).toMatchObject({ name: '木阳站', nameS: 'Muyang Railway Station', x: 6275, y: 3975 })
    expect(project.stations.find(station => station.source?.pointId === 57)?.nameS).toBe('Muyang West\nRailway Station')
  })

  it('imports the AARC global visual calibration without scaling any world geometry', () => {
    const { project } = imported()
    expect(project.settings.lineWidth).toBeCloseTo(22.035, 3)
    expect(project.settings.stationSize).toBeCloseTo(14, 6)
    expect(project.settings.transferMinorAxis).toBeCloseTo(23.871, 3)
    expect(project.settings.transferDotGap).toBe(5)
    expect(project.settings.stationLabelSize).toBeCloseTo(30.68, 2)
    expect(project.settings.stationForeignLabelSize).toBeCloseTo(20.5, 1)
    const sourcePoints = new Map((rawSample.points as Array<{id:number;pos:number[]}>).map(point => [point.id, point.pos]))
    for (const station of project.stations) {
      const source = sourcePoints.get(station.source!.pointId!)!
      expect([station.x, station.y]).toEqual([source[0], source[1]])
    }
  })

  it('preserves nameP exactly for every real named Station and never derives rotation from direction',()=>{
    const {project}=imported(),points=new Map((rawSample.points as Array<{id:number;sta:number;name?:string;nameP?:[number,number]}>).map(point=>[point.id,point])),namedStations=project.stations.filter(station=>{const point=points.get(station.source?.pointId??-1);return Boolean(point?.name)}),mismatches=namedStations.filter(station=>{const point=points.get(station.source!.pointId!);return !point?.nameP||Math.abs(station.labelOffsetX-point.nameP[0])>1e-9||Math.abs(station.labelOffsetY-point.nameP[1])>1e-9})
    expect(namedStations).toHaveLength(100);expect(mismatches).toEqual([]);expect(project.stations.every(station=>station.labelRotation===undefined)).toBe(true)
    expect(namedStations.every(station => station.source?.labelAnchorMode === 'aarc-block')).toBe(true)
    expect(namedStations.every(station => station.source?.stationNameFontWeight === 'bold')).toBe(true)
    expect(namedStations.every(station => {
      const point = points.get(station.source!.pointId!)
      return station.source?.nameP?.[0] === point?.nameP?.[0] && station.source?.nameP?.[1] === point?.nameP?.[1]
    })).toBe(true)
  })
  it('maps sta:0 to an ordered waypoint, never a Station', () => {
    const { project, summary } = imported()
    expect(summary.stationCount).toBe(102)
    expect(summary.explicitWaypointCount).toBe(1)
    expect(summary.implicitCornerCount).toBeGreaterThan(0)
    expect(summary.totalWaypointCount).toBe(summary.explicitWaypointCount + summary.implicitCornerCount)
    expect(project.stations.some(station => station.source?.pointId === 66)).toBe(false)
    const segment = project.geometry.segments.find(item => item.lineId === 'aarc-line-62' && item.fromStationId === 'aarc-station-65' && item.toStationId === 'aarc-station-60')
    expect(segment?.mode).toBe('rounded')
    expect(segment?.waypoints).toContainEqual(expect.objectContaining({ x: 5200, y: 5050, type: 'corner', source: expect.objectContaining({ pointId: 66, kind: 'explicit-control-point' }) }))
  })

  it('uses a shared real Point id as one transfer Station with multiple relations', () => {
    const { project } = imported(), station = project.stations.find(item => item.source?.pointId === 60)!
    expect(project.stationLineRelations.filter(relation => relation.stationId === station.id).map(relation => relation.lineId).sort()).toEqual(['aarc-line-62', 'aarc-line-8'])
    expect(project.stations.filter(item => item.source?.pointId === 60)).toHaveLength(1)
  })

  it('round-trips through native ActualRouteProject JSON without losing core AARC data', () => {
    const original = imported().project, restored = parseProjectJson(serializeProject(original))
    expect(restored.lines).toHaveLength(original.lines.length)
    expect(restored.stations).toHaveLength(original.stations.length)
    expect(restored.geometry.segments).toHaveLength(original.geometry.segments.length)
    expect(restored.geometry.segments.flatMap(segment => segment.waypoints)).toHaveLength(original.geometry.segments.flatMap(segment => segment.waypoints).length)
    expect(restored.stations.find(station => station.source?.pointId === 57)?.nameS).toBe('Muyang West\nRailway Station')
    expect(restored.stations.find(station => station.source?.pointId === 57)?.source?.nameP).toEqual([0, 16.2])
    expect(restored.settings.lineWidth).toBeCloseTo(original.settings.lineWidth)
  })

  it('does not invent dates from the sample non-standard numeric time.open values', () => {
    const { project, summary } = imported()
    expect(project.lines.every(line => line.openedAt === null)).toBe(true)
    expect(summary.warnings.filter(warning => warning.includes('time.open'))).toHaveLength(4)
  })
})
