import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { createOperationEvent } from '../data/operationEvents'
import { getOpeningPhasePathCandidates } from '../data/openingPhases'
import { compileHistoryEvents, compilePresentation } from './compiler'
import { getPresentationState } from './engine'

describe('presentation repeated operation history', () => {
  it('compiles closure followed by a later network reopening and ends visible again', () => {
    let project = structuredClone(demoProject)
    const path = getOpeningPhasePathCandidates(project, 'line-a', 's1', 's4')[0]
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }).project
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2035-01-01', state: 'open', path }).project
    const settings = { ...project.presentation, startDate: '2029-01-01', endDate: '2036-01-01' }
    const events = compileHistoryEvents(project, settings)
    expect(events.some(event => event.historyDate === '2030-01-01' && event.eventTypes.includes('LINE_CLOSURE'))).toBe(true)
    expect(events.some(event => event.historyDate === '2035-01-01' && event.eventTypes.includes('SEGMENT_OPENING'))).toBe(true)
    const sequence = compilePresentation(project, settings)
    const final = getPresentationState(project, sequence, sequence.duration)
    expect(final.segmentStates['a-2'].opacity).toBeGreaterThan(0)
    expect(final.stationStates.s3.lineIds).toContain('line-a')
  })

  it('does not compile a station-only reopening while its parent network remains stopped', () => {
    let project = structuredClone(demoProject)
    const path = getOpeningPhasePathCandidates(project, 'line-a', 's1', 's4')[0]
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }).project
    const relation = project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!
    relation.operationHistory = [...(relation.operationHistory ?? []), { id: 'manual-open', effectiveAt: '2035-01-01', state: 'open' }]
    const settings = { ...project.presentation, startDate: '2029-01-01', endDate: '2036-01-01' }
    const events = compileHistoryEvents(project, settings)
    expect(events.some(event => event.historyDate === '2035-01-01' && event.type === 'STATION_OPENING' && event.stationIds.includes('s3'))).toBe(false)
  })
})
