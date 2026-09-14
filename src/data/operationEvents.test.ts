import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getOpeningPhasePathCandidates } from './openingPhases'
import { createClosureEvent, getClosureSegmentIds, isClosureOperationEvent, updateClosureEvent } from './operationEvents'

function project() { return structuredClone(demoProject) }

describe('operation closure events', () => {
  it('closes complete station-to-station segments without closing a boundary station that remains served', () => {
    const base = project()
    const path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const result = createClosureEvent(base, { lineId: 'line-a', name: '东段停运', closedAt: '2030-01-01', path })
    const phase = result.project.openingPhases.find(item => item.id === result.phaseId)!
    expect(isClosureOperationEvent(phase)).toBe(true)
    expect(getClosureSegmentIds(phase)).toEqual(['a-2', 'a-3'])
    expect(result.project.geometry.segments.find(item => item.id === 'a-2')?.closedAt).toBe('2030-01-01')
    expect(result.project.geometry.segments.find(item => item.id === 'a-3')?.closedAt).toBe('2030-01-01')
    expect(result.project.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')?.closedAt).toBeFalsy()
    expect(result.project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')?.closedAt).toBe('2030-01-01')
    expect(result.project.stationLineRelations.find(item => item.stationId === 's4' && item.lineId === 'line-a')?.closedAt).toBe('2030-01-01')
  })

  it('updates inherited closure dates but preserves a manually overridden object date', () => {
    const base = project()
    const path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const created = createClosureEvent(base, { lineId: 'line-a', closedAt: '2030-01-01', path })
    created.project.geometry.segments.find(item => item.id === 'a-3')!.closedAt = '2031-06-01'
    const updated = updateClosureEvent(created.project, created.phaseId, '2030-12-31')
    expect(updated.geometry.segments.find(item => item.id === 'a-2')?.closedAt).toBe('2030-12-31')
    expect(updated.geometry.segments.find(item => item.id === 'a-3')?.closedAt).toBe('2031-06-01')
  })

  it('sets the line closure date when the operation event covers the whole line', () => {
    const base = project()
    const path = getOpeningPhasePathCandidates(base, 'line-a', 's1', 's4')[0]
    const result = createClosureEvent(base, { lineId: 'line-a', closedAt: '2040-01-01', path })
    expect(result.project.lines.find(item => item.id === 'line-a')?.closedAt).toBe('2040-01-01')
  })
})
