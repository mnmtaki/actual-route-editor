import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getOpeningPhasePathCandidates } from './openingPhases'
import { createOperationEvent, deleteOperationEvent, isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt, resolveOperationState, updateOperationEvent } from './operationEvents'

function project() { return structuredClone(demoProject) }

describe('repeated operation history', () => {
  it('supports open -> close -> reopen -> close on the same complete station interval', () => {
    let current = project()
    const path = getOpeningPhasePathCandidates(current, 'line-a', 's2', 's4')[0]
    const close = createOperationEvent(current, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }); current = close.project
    const reopen = createOperationEvent(current, { lineId: 'line-a', effectiveAt: '2035-06-01', state: 'open', path }); current = reopen.project
    current = createOperationEvent(current, { lineId: 'line-a', effectiveAt: '2040-01-01', state: 'closed', path }).project
    const segment = current.geometry.segments.find(item => item.id === 'a-2')!
    expect(isSegmentOperationalAt(segment, '2029-12-31')).toBe(true)
    expect(isSegmentOperationalAt(segment, '2030-01-01')).toBe(false)
    expect(isSegmentOperationalAt(segment, '2035-06-01')).toBe(true)
    expect(isSegmentOperationalAt(segment, '2040-01-01')).toBe(false)
    expect(segment.operationHistory?.map(entry => entry.state)).toEqual(['closed', 'open', 'closed'])
    expect(current.operationEvents).toHaveLength(3)
    expect(isLineOperationalAt(current.lines.find(item => item.id === 'line-a'), '2035-06-01')).toBe(true)
  })

  it('makes closure win over opening on the same date, regardless of insertion order', () => {
    expect(resolveOperationState(undefined, undefined, [
      { id: 'close', effectiveAt: '2030-01-01', state: 'closed' },
      { id: 'open', effectiveAt: '2030-01-01', state: 'open' },
    ], '2030-01-01')).toBe(false)
    expect(resolveOperationState(undefined, undefined, [
      { id: 'open', effectiveAt: '2030-01-01', state: 'open' },
      { id: 'close', effectiveAt: '2030-01-01', state: 'closed' },
    ], '2030-01-01')).toBe(false)
  })

  it('allows a later opening event to restore service after closure', () => {
    expect(resolveOperationState('2020-01-01', '2030-01-01', [{ id: 'reopen', effectiveAt: '2035-01-01', state: 'open' }], '2036-01-01')).toBe(true)
  })

  it('does not close a boundary station relation when another incident segment remains active', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const result = createOperationEvent(base, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path })
    const s2 = result.project.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')!
    const s3 = result.project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!
    expect(s2.operationHistory).toBeUndefined()
    expect(isRelationOperationalAt(s2, '2031-01-01')).toBe(true)
    expect(isRelationOperationalAt(s3, '2031-01-01')).toBe(false)
  })

  it('updates and deletes an event atomically across every target history', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const created = createOperationEvent(base, { lineId: 'line-a', name: '复开', effectiveAt: '2035-01-01', state: 'open', path })
    const updated = updateOperationEvent(created.project, created.eventId, { effectiveAt: '2036-01-01', name: '恢复运营' })
    expect(updated.operationEvents?.[0].effectiveAt).toBe('2036-01-01')
    expect(updated.geometry.segments.find(item => item.id === 'a-2')?.operationHistory?.[0].effectiveAt).toBe('2036-01-01')
    const deleted = deleteOperationEvent(updated, created.eventId)
    expect(deleted.operationEvents).toBeUndefined()
    expect(deleted.geometry.segments.find(item => item.id === 'a-2')?.operationHistory).toBeUndefined()
  })
})
