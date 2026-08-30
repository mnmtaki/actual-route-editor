import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { appendStationToLine } from './operations'
import { createOpeningPhase, getOpeningPhasePathCandidates, markSegmentDateOverride, updateOpeningPhase } from './openingPhases'

function project() { return structuredClone(demoProject) }

describe('opening phases', () => {
  it('finds a continuous line path and exposes branch or loop ambiguity instead of guessing', () => {
    const base = project()
    expect(getOpeningPhasePathCandidates(base, 'line-a', 's1', 's4')).toHaveLength(1)
    base.geometry.segments.push({ id: 'loop', lineId: 'line-a', fromStationId: 's4', toStationId: 's1', mode: 'straight', structureType: 'underground', waypoints: [], openedAt: '2026-01-01' })
    const candidates = getOpeningPhasePathCandidates(base, 'line-a', 's1', 's3')
    expect(candidates.length).toBe(2)
    expect(candidates.map(candidate => candidate.segmentIds.join(','))).toEqual(expect.arrayContaining(['a-1,a-2', 'loop,a-3']))
  })

  it('sets one extension date across selected segments and new relations but preserves the existing connection station', () => {
    const base = project()
    const path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const result = createOpeningPhase(base, { lineId: 'line-a', name: '东延', openedAt: '2026-01-01', path })
    const phase = result.project.openingPhases.find(item => item.id === result.phaseId)!
    expect(phase.segmentIds).toEqual(['a-2', 'a-3'])
    expect(result.project.geometry.segments.filter(item => phase.segmentIds.includes(item.id)).every(item => item.openedAt === '2026-01-01')).toBe(true)
    expect(result.project.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')?.openedAt).toBe('2000-01-01')
    expect(result.project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')?.openedAt).toBe('2026-01-01')
    expect(result.project.stationLineRelations.find(item => item.stationId === 's4' && item.lineId === 'line-a')?.openedAt).toBe('2026-01-01')
  })

  it('updates all non-overridden members and keeps an explicit single-object override', () => {
    const base = project(), path = getOpeningPhasePathCandidates(base, 'line-a', 's2', 's4')[0]
    const created = createOpeningPhase(base, { lineId: 'line-a', openedAt: '2026-01-01', path })
    const overridden = structuredClone(created.project)
    markSegmentDateOverride(overridden, 'a-3')
    overridden.geometry.segments.find(item => item.id === 'a-3')!.openedAt = '2026-03-15'
    const updated = updateOpeningPhase(overridden, created.phaseId, { openedAt: '2026-06-28' })
    expect(updated.geometry.segments.find(item => item.id === 'a-2')?.openedAt).toBe('2026-06-28')
    expect(updated.geometry.segments.find(item => item.id === 'a-3')?.openedAt).toBe('2026-03-15')
    expect(updated.openingPhases[0].overriddenSegmentIds).toContain('a-3')
  })

  it('automatically inherits an empty phase date while drawing and never rewrites the existing anchor relation', () => {
    const base = project()
    const created = createOpeningPhase(base, { lineId: 'line-a', name: '南延', openedAt: '2028-06-28' })
    const appended = appendStationToLine(created.project, 'line-a', { x: 980, y: 360 }, 's4', created.phaseId)
    const phase = appended.project.openingPhases.find(item => item.id === created.phaseId)!
    const relation = appended.project.stationLineRelations.find(item => item.stationId === appended.stationId && item.lineId === 'line-a')!
    const segment = appended.project.geometry.segments.find(item => item.fromStationId === 's4' && item.toStationId === appended.stationId)!
    expect(relation.openedAt).toBe('2028-06-28'); expect(segment.openedAt).toBe('2028-06-28')
    expect(phase.stationRelationIds).toContain(relation.id); expect(phase.segmentIds).toContain(segment.id)
    expect(appended.project.stationLineRelations.find(item => item.stationId === 's4' && item.lineId === 'line-a')?.openedAt).toBe('2000-01-01')
  })

  it('changes only the selected line relation at an interchange', () => {
    const base = project()
    const redDate = base.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')!.openedAt
    const path = getOpeningPhasePathCandidates(base, 'line-c', 's7', 's2')[0]
    const result = createOpeningPhase(base, { lineId: 'line-c', openedAt: '2026-01-01', path }).project
    expect(result.stationLineRelations.find(item => item.stationId === 's2' && item.lineId === 'line-a')?.openedAt).toBe(redDate)
    expect(result.stationLineRelations.find(item => item.stationId === 's7' && item.lineId === 'line-c')?.openedAt).toBe('2026-01-01')
  })
})