import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { createOperationEvent } from '../data/operationEvents'
import { getOpeningPhasePathCandidates } from '../data/openingPhases'
import { getActiveLinesAtStation, getActiveNetworkAtTime, getFirstLineAtStation, getPassengerVisibleRelationIds, isActiveAt } from './active'

describe('timeline', () => {
  it('uses opened inclusive and closed exclusive dates', () => {
    expect(isActiveAt('2010-01-01', '2020-01-01', '2010-01-01')).toBe(true)
    expect(isActiveAt('2010-01-01', '2020-01-01', '2020-01-01')).toBe(false)
  })

  it('changes a shared station from one to two to three active lines', () => {
    expect(getActiveLinesAtStation(demoProject, 's2', '2005-01-01')).toHaveLength(1)
    expect(getActiveLinesAtStation(demoProject, 's2', '2015-01-01')).toHaveLength(2)
    expect(getActiveLinesAtStation(demoProject, 's2', '2025-01-01')).toHaveLength(3)
  })

  it('orders lines by station relation date, then stable lineOrder', () => {
    expect(getFirstLineAtStation(demoProject, 's2')?.id).toBe('line-a')
    expect(getActiveLinesAtStation(demoProject, 's2', '2025-01-01').map((line) => line.id)).toEqual(['line-a', 'line-b', 'line-c'])
  })

  it('filters segments and stations for a historical date', () => {
    const network = getActiveNetworkAtTime(demoProject, '2005-01-01')
    expect(network.lines.map((line) => line.id)).toEqual(['line-a'])
    expect(network.stations).toHaveLength(4)
  })
  it('resolves historical segment ownership in a derived view without mutating the project', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments[0]
    segment.lineHistory = [
      { id: 'segment-baseline', effectiveAt: null, lineId: 'line-a' },
      { id: 'segment-handoff', effectiveAt: '2020-01-01', lineId: 'line-b' },
    ]
    segment.lineId = 'line-b'
    const before = structuredClone(project)
    const beforeHandoff = getActiveNetworkAtTime(project, '2015-01-01')
    const afterHandoff = getActiveNetworkAtTime(project, '2021-01-01')
    expect(beforeHandoff.segments.find(item => item.id === segment.id)?.lineId).toBe('line-a')
    expect(beforeHandoff.segments.find(item => item.id === segment.id)?.effectiveLineIdAtCurrentDate).toBe('line-a')
    expect(afterHandoff.segments.find(item => item.id === segment.id)?.lineId).toBe('line-b')
    expect(project).toEqual(before)
  })

  it('keeps the canonical compound station when only an auxiliary member relation is active', () => {
    const project = structuredClone(demoProject)
    const canonical = project.stations.find(station => station.id === 's2')!
    canonical.compoundGroupId = 'civic'
    project.stations.push({ ...canonical, id: 's2-aux', name: '辅助成员', x: canonical.x + 10, compoundGroupId: 'civic' })
    project.stationLineRelations = project.stationLineRelations.map(relation => relation.stationId === 's2' ? { ...relation, openedAt: '2030-01-01' } : relation)
    project.stationLineRelations.push({ id: 'r-aux-a', stationId: 's2-aux', lineId: 'line-a', openedAt: '2000-01-01' })
    const active = getActiveNetworkAtTime(project, '2025-01-01')
    expect(active.stations.map(station => station.id)).toContain('s2')
    expect(active.stations.map(station => station.id)).not.toContain('s2-aux')
    expect(active.relations.map(relation => relation.id)).toContain('r-aux-a')
  })

  it('keeps compound visibility stable as canonical and auxiliary relations toggle', () => {
    const project = structuredClone(demoProject)
    const canonical = project.stations.find(station => station.id === 's2')!
    canonical.compoundGroupId = 'civic'
    project.stations.push({ ...canonical, id: 's2-aux', name: '辅助成员', compoundGroupId: 'civic' })
    project.stationLineRelations = project.stationLineRelations.map(relation => relation.stationId === 's2' ? { ...relation, openedAt: '2000-01-01', closedAt: '2020-01-01' } : relation)
    project.stationLineRelations.push({ id: 'r-aux-a', stationId: 's2-aux', lineId: 'line-a', openedAt: '2020-01-01' })
    expect(getActiveNetworkAtTime(project, '2010-01-01').stations.map(station => station.id)).toContain('s2')
    expect(getActiveNetworkAtTime(project, '2025-01-01').stations.map(station => station.id)).toContain('s2')
    project.stationLineRelations = project.stationLineRelations.map(relation => relation.id === 'r-aux-a' ? { ...relation, closedAt: '2021-01-01' } : relation)
    expect(getActiveNetworkAtTime(project, '2025-01-01').stations.map(station => station.id)).not.toContain('s2')
  })
  it('retains a concrete branch relation after passenger-family collapsing', () => {
    const project = structuredClone(demoProject)
    const branch = { ...project.lines[0], id: 'line-a-branch', name: '澄川支线', parentLineId: 'line-a', stationSequence: ['s1', 's2'], lineOrder: 3 }
    project.lines.push(branch)
    project.stationLineRelations = project.stationLineRelations.filter(relation => !(relation.stationId === 's2' && relation.lineId === 'line-a'))
    project.stationLineRelations.push({ id: 'r-branch-s2', stationId: 's2', lineId: branch.id, openedAt: '2000-01-01' })
    expect(getPassengerVisibleRelationIds(project, 's2', '2015-01-01')).toContain('r-branch-s2')
  })

  it('reopens a previously closed segment through operation history', () => {
    const project = structuredClone(demoProject)
    const segment = project.geometry.segments[0]
    segment.closedAt = '2030-01-01'
    segment.operationHistory = [{ id: 'reopen', effectiveAt: '2035-01-01', state: 'open' }]
    const line = project.lines.find(item => item.id === segment.lineId)!
    line.closedAt = '2030-01-01'
    line.operationHistory = [{ id: 'line-reopen', effectiveAt: '2035-01-01', state: 'open' }]
    expect(getActiveNetworkAtTime(project, '2031-01-01').segments.some(item => item.id === segment.id)).toBe(false)
    expect(getActiveNetworkAtTime(project, '2035-01-01').segments.some(item => item.id === segment.id)).toBe(true)
  })

  it('lets a station-level closure override an open parent service', () => {
    const project = structuredClone(demoProject)
    const relation = project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!
    relation.closedAt = '2030-01-01'
    expect(getActiveLinesAtStation(project, 's3', '2031-01-01').map(line => line.id)).not.toContain('line-a')
    expect(getActiveNetworkAtTime(project, '2031-01-01').segments.filter(segment => segment.lineId === 'line-a')).toHaveLength(3)
  })

  it('does not let a station-level opening override a stopped parent service', () => {
    let project = structuredClone(demoProject)
    const path = getOpeningPhasePathCandidates(project, 'line-a', 's1', 's4')[0]
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }).project
    const relation = project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!
    relation.operationHistory = [...(relation.operationHistory ?? []), { id: 'manual-reopen', effectiveAt: '2035-01-01', state: 'open' }]
    expect(getActiveLinesAtStation(project, 's3', '2035-01-01').map(line => line.id)).not.toContain('line-a')
    expect(getActiveNetworkAtTime(project, '2035-01-01').segments.filter(segment => segment.lineId === 'line-a')).toHaveLength(0)
  })

  it('allows a later network opening event to reopen service after a full closure', () => {
    let project = structuredClone(demoProject)
    const path = getOpeningPhasePathCandidates(project, 'line-a', 's1', 's4')[0]
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }).project
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2035-01-01', state: 'open', path }).project
    expect(getActiveNetworkAtTime(project, '2031-01-01').segments.filter(segment => segment.lineId === 'line-a')).toHaveLength(0)
    expect(getActiveNetworkAtTime(project, '2035-01-01').segments.filter(segment => segment.lineId === 'line-a')).toHaveLength(3)
    expect(getActiveLinesAtStation(project, 's3', '2035-01-01').map(line => line.id)).toContain('line-a')
  })
})
