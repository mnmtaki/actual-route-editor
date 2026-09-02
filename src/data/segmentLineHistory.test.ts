import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from './model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from './model'
import { appendSegmentLineHistory, resolveSegmentLineAt, validateSegmentLineHistory } from './segmentLineHistory'
import { splitLineAtStation } from './operations'
import { compileHistoryEvents, compilePresentation } from '../presentation/compiler'
import { getPresentationState } from '../presentation/engine'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

const baseProject = (): ActualRouteProject => {
  const stations = ['A', 'B', 'C', 'D', 'E'].map((id, index) => ({ id, name: id, x: index * 100, y: 0, labelOffsetX: 10, labelOffsetY: -10, openedAt: '2010-01-01' as string | null }))
  const line = { id: 'L1', name: '1号线', color: '#d33', stationSequence: stations.map(item => item.id), lineOrder: 0, openedAt: '2010-01-01' as string | null, visible: true, locked: false }
  const relations = stations.map(station => ({ id: `r1-${station.id}`, stationId: station.id, lineId: 'L1', openedAt: '2010-01-01' as string | null }))
  const segments: Segment[] = stations.slice(0, -1).map((station, index) => ({ id: `${station.id}${stations[index + 1].id}`, lineId: 'L1', fromStationId: station.id, toStationId: stations[index + 1].id, mode: 'straight', structureType: 'underground', waypoints: [], openedAt: '2010-01-01', closedAt: null }))
  return { version: 1, name: 'split', stations, lines: [line], stationLineRelations: relations, openingPhases: [], geometry: { segments }, background: null, mapElements: [], timeline: { currentDate: '2021-01-01', startDate: '2010-01-01', endDate: '2021-01-01', playing: false }, presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: '2010-01-01', endDate: '2021-01-01', pauseDuration: 0 }, settings: { ...DEFAULT_SETTINGS } }
}

describe('segment line history', () => {
  it('resolves baseline and dated ownership without changing physical identity', () => {
    const segment = baseProject().geometry.segments[2]
    appendSegmentLineHistory(segment, 'L5', '2020-01-01', 'change')
    expect(resolveSegmentLineAt(segment, '2015-01-01')).toBe('L1')
    expect(resolveSegmentLineAt(segment, '2021-01-01')).toBe('L5')
    expect(segment.lineId).toBe('L5')
    expect(segment.id).toBe('CD')
  })
  it('validates duplicate dates and missing baseline', () => {
    expect(validateSegmentLineHistory({ lineId: 'L2', lineHistory: [{ id: 'a', effectiveAt: '2020-01-01', lineId: 'L3' }] })).toContain('线路归属历史必须包含基准线路')
    expect(validateSegmentLineHistory({ lineId: 'L2', lineHistory: [{ id: 'b', effectiveAt: null, lineId: 'L2' }, { id: 'a', effectiveAt: '2020-01-01', lineId: 'L3' }, { id: 'c', effectiveAt: '2020-01-01', lineId: 'L4' }] })).toContain('区间线路归属在 2020-01-01 重复变更')
  })
  it('splits a continuous line, keeps C on the old relation and moves physical segments', () => {
    const result = splitLineAtStation(baseProject(), { lineId: 'L1', splitStationId: 'C', side: 'after', openedAt: '2020-01-01', name: '5号线', color: '#55c' })
    expect(result.error).toBeUndefined()
    const project = result.project, newLine = project.lines.find(line => line.id === result.newLineId)!
    expect(project.lines.find(line => line.id === 'L1')?.stationSequence).toEqual(['A', 'B', 'C'])
    expect(newLine.stationSequence).toEqual(['C', 'D', 'E'])
    expect(project.geometry.segments.find(segment => segment.id === 'CD')?.lineId).toBe(result.newLineId)
    expect(resolveSegmentLineAt(project.geometry.segments.find(segment => segment.id === 'CD')!, '2015-01-01')).toBe('L1')
    expect(project.stationLineRelations.find(relation => relation.stationId === 'C' && relation.lineId === 'L1')?.closedAt).toBeUndefined()
    expect(project.stationLineRelations.find(relation => relation.stationId === 'C' && relation.lineId === result.newLineId)?.openedAt).toBe('2020-01-01')
    expect(project.stationLineRelations.find(relation => relation.stationId === 'D' && relation.lineId === 'L1')?.closedAt).toBe('2020-01-01')
    const opening = compileHistoryEvents(project).find(event => event.historyDate === '2010-01-01' && event.type === 'LINE_OPENING')!
    expect(opening.branches[0].map(item => item.segmentId)).toEqual(['AB', 'BC', 'CD', 'DE'])
  })
  it('round-trips segment ownership history and keeps legacy projects unchanged', () => {
    const project = baseProject(), segment = project.geometry.segments[2]
    appendSegmentLineHistory(segment, 'L5', '2020-01-01', 'change')
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.geometry.segments.find(item => item.id === 'CD')?.lineHistory).toEqual(segment.lineHistory)
    const legacy = parseProjectJson(serializeProject(baseProject()))
    expect(legacy.geometry.segments.every(item => item.lineHistory === undefined)).toBe(true)
  })
  it('switches Presentation colors and per-line mileage at reassignment without a new opening', () => {
    const split = splitLineAtStation(baseProject(), { lineId: 'L1', splitStationId: 'C', side: 'after', openedAt: '2020-01-01', name: '5号线', color: '#55c' })
    const project = split.project, sequence = compilePresentation(project), reassignment = sequence.beats.find(beat => beat.type === 'LINE_REASSIGNMENT')!
    expect(reassignment).toBeTruthy()
    const reassignmentEvents = compileHistoryEvents(project)
    expect(reassignmentEvents.filter(event => event.type === 'LINE_OPENING' && event.historyDate === '2020-01-01')).toHaveLength(0)
    expect(reassignmentEvents.filter(event => event.type === 'STATION_OPENING' && event.historyDate === '2020-01-01')).toHaveLength(0)
    const before = getPresentationState(project, sequence, reassignment.presentationStart - 1e-4)
    const after = getPresentationState(project, sequence, reassignment.presentationStart + 0.0005)
    expect(before.segmentStates.CD.lineId).toBe('L1')
    expect(after.segmentStates.CD.lineId).toBe(split.newLineId)
    expect(before.lineStatistics.find(item => item.lineId === 'L1')?.operatingLengthKm).toBeGreaterThan(after.lineStatistics.find(item => item.lineId === 'L1')?.operatingLengthKm ?? 0)
    expect(after.statistics.operatingLengthKm).toBeLessThanOrEqual(4)
  })
})