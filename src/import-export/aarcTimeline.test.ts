import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/桐洲地铁未来规划.aarc.json'
import { convertAarcToActualRouteProject } from './aarc'
import { compilePresentation, compileHistoryEvents } from '../presentation/compiler'
import { getPresentationState } from '../presentation/engine'
import { parseProjectJson, serializeProject } from './projectJson'

const imported = () => convertAarcToActualRouteProject(rawSample, '桐洲地铁未来规划.aarc.json')
const stationId = (project: ReturnType<typeof imported>['project'], pointId: number) => project.stations.find(station => station.source?.pointId === pointId)?.id
const relation = (project: ReturnType<typeof imported>['project'], pointId: number, sourceLineId: number) => project.stationLineRelations.find(item => item.stationId === stationId(project, pointId) && item.lineId === `aarc-line-${sourceLineId}`)
const segment = (project: ReturnType<typeof imported>['project'], sourceLineId: number, fromPointId: number, toPointId: number) => {
  const from = stationId(project, fromPointId), to = stationId(project, toPointId)
  return project.geometry.segments.find(item => item.lineId === `aarc-line-${sourceLineId}` && item.fromStationId === from && item.toStationId === to)
}

describe('AARC timeline import with 桐洲地铁未来规划', () => {
  it('imports real line dates and bounds the project timeline by imported dates', () => {
    const { project, summary } = imported()
    expect(summary.realLineCount).toBe(30)
    expect(project.lines.find(line => line.source?.lineId === 214)?.openedAt).toBe('2025-02-10')
    expect(project.lines.find(line => line.source?.lineId === 282)?.openedAt).toBe('2026-05-20')
    expect(project.timeline.startDate).toBe('2023-02-07')
    expect(project.timeline.endDate > '2028-01-01').toBe(true)
    expect(project.timeline.currentDate).toBe(project.timeline.endDate)
    expect(project.presentation.startDate).toBe(project.timeline.startDate)
    expect(project.presentation.endDate).toBe(project.timeline.endDate)
  })

  it('maps the 2025 extension slice to segment and station-relation openings', () => {
    const { project } = imported()
    expect(segment(project, 214, 218, 219)?.openedAt).toBe('2025-02-11')
    expect(relation(project, 218, 214)?.openedAt).toBe('2025-02-10')
    expect(relation(project, 219, 214)?.openedAt).toBe('2025-02-11')
  })

  it('maps reverse and forward slices on 桐陇城际 without changing geometry', () => {
    const { project } = imported()
    expect(segment(project, 282, 142, 494)?.openedAt).toBe('2026-06-07')
    expect(relation(project, 142, 282)?.openedAt).toBe('2026-05-20')
    expect(relation(project, 506, 282)?.openedAt).toBe('2026-06-07')
    const sourcePoint = (rawSample.points as Array<{ id: number; pos: number[] }>).find(point => point.id === 506)!
    const station = project.stations.find(item => item.source?.pointId === 506)!
    expect([station.x, station.y]).toEqual(sourcePoint.pos)
  })

  it('feeds imported dates into History and deterministic Presentation mileage/stations', () => {
    const { project } = imported()
    const history = compileHistoryEvents(project, project.presentation)
    expect(history.some(event => event.historyDate === '2025-02-10' && event.lineId === 'aarc-line-214')).toBe(true)
    expect(history.some(event => event.historyDate === '2025-02-11' && event.lineId === 'aarc-line-214')).toBe(true)
    expect(history.some(event => event.historyDate === '2026-05-20' && event.lineId === 'aarc-line-282')).toBe(true)
    expect(history.some(event => event.historyDate === '2026-06-07' && event.lineId === 'aarc-line-282')).toBe(true)
    const sequence = compilePresentation(project)
    const extension = sequence.beats.find(beat => beat.historyDate === '2025-02-11' && beat.lineId === 'aarc-line-214')
    expect(extension).toBeTruthy()
    const before = getPresentationState(project, sequence, extension!.revealStart - 0.001)
    const after = getPresentationState(project, sequence, extension!.revealEnd + 0.001)
    const extensionSegment = segment(project, 214, 218, 219)!
    expect(before.segmentStates[extensionSegment.id].opacity).toBe(0)
    expect(after.segmentStates[extensionSegment.id].opacity).toBe(1)
    expect(after.statistics.operatingLengthKm).toBeGreaterThan(before.statistics.operatingLengthKm)
    expect(after.statistics.stationCount).toBeGreaterThanOrEqual(before.statistics.stationCount)
  })

  it('round-trips imported temporal fields through native project JSON', () => {
    const original = imported().project
    const restored = parseProjectJson(serializeProject(original))
    expect(restored.lines.find(line => line.source?.lineId === 214)?.openedAt).toBe('2025-02-10')
    expect(segment(restored, 214, 218, 219)?.openedAt).toBe('2025-02-11')
    expect(relation(restored, 219, 214)?.openedAt).toBe('2025-02-11')
    expect(restored.timeline.startDate).toBe(original.timeline.startDate)
    expect(restored.timeline.endDate).toBe(original.timeline.endDate)
  })
})
