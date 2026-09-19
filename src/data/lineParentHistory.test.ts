import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getEffectiveLineColor, getRootLineId, collapseLinesByServiceFamily } from './lineIdentity'
import { getLineParentIdAt, projectWithLineParentsAt, updateLineParentHistoryEntry, validateLineParentHistory } from './lineParentHistory'
import { deleteLineAndOrphans } from './operations'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compileHistoryEvents } from '../presentation/compiler'

function projectWithHistory() {
  const project = structuredClone(demoProject)
  const branch = {
    id: 'line-branch',
    name: '机场线',
    color: '#a855f7',
    stationSequence: ['s1','s2'],
    lineOrder: 3,
    openedAt: '2000-01-01',
    visible: true,
    locked: false,
    parentHistory: [
      { id: 'base', effectiveAt: null, parentLineId: null },
      { id: 'join', effectiveAt: '2010-01-01', parentLineId: 'line-a' },
      { id: 'leave', effectiveAt: '2020-01-01', parentLineId: null },
    ],
  }
  project.lines.push(branch)
  return project
}

describe('line parent history', () => {
  it('resolves independent, branch, and independent states by date', () => {
    const project = projectWithHistory()
    const line = project.lines.find(item => item.id === 'line-branch')!
    expect(getLineParentIdAt(line, '2005-01-01')).toBeUndefined()
    expect(getLineParentIdAt(line, '2015-01-01')).toBe('line-a')
    expect(getLineParentIdAt(line, '2025-01-01')).toBeUndefined()
    expect(getRootLineId(project, line, '2005-01-01')).toBe('line-branch')
    expect(getRootLineId(project, line, '2015-01-01')).toBe('line-a')
    expect(getRootLineId(project, line, '2025-01-01')).toBe('line-branch')
    expect(getEffectiveLineColor(project, line, '2005-01-01')).toBe('#a855f7')
    expect(getEffectiveLineColor(project, line, '2015-01-01')).toBe(project.lines[0].color)
    expect(getEffectiveLineColor(project, line, '2025-01-01')).toBe('#a855f7')
  })

  it('changes passenger-family collapsing across the relationship history', () => {
    const project = projectWithHistory()
    const main = project.lines.find(item => item.id === 'line-a')!
    const branch = project.lines.find(item => item.id === 'line-branch')!
    expect(collapseLinesByServiceFamily(project, [main, branch], '2005-01-01')).toHaveLength(2)
    expect(collapseLinesByServiceFamily(project, [main, branch], '2015-01-01')).toHaveLength(1)
    expect(collapseLinesByServiceFamily(project, [main, branch], '2025-01-01')).toHaveLength(2)
  })

  it('supports historical multi-level parents while rejecting cycles at any date', () => {
    const project = projectWithHistory()
    project.lines.push({
      id: 'line-subbranch',
      name: '航站楼支线',
      color: '#000000',
      parentLineId: 'line-branch',
      stationSequence: ['s1'],
      lineOrder: 4,
      openedAt: '2015-01-01',
      visible: true,
      locked: false,
    })
    expect(getRootLineId(project, 'line-subbranch', '2015-01-01')).toBe('line-a')
    expect(getEffectiveLineColor(project, 'line-subbranch', '2015-01-01')).toBe(project.lines[0].color)
    expect(validateLineParentHistory(project)).toEqual([])

    expect(() => updateLineParentHistoryEntry(project, 'line-a', {
      id: 'cycle',
      effectiveAt: '2015-01-01',
      parentLineId: 'line-subbranch',
    })).toThrow('循环')
  })

  it('round-trips parent history and syncs the current relationship', () => {
    const project = projectWithHistory()
    const line = project.lines.find(item => item.id === 'line-branch')!
    updateLineParentHistoryEntry(project, line.id, {
      id: 'rejoin',
      effectiveAt: '2030-01-01',
      parentLineId: 'line-b',
    })
    expect(line.parentLineId).toBe('line-b')
    const restored = parseProjectJson(serializeProject(project))
    const restoredLine = restored.lines.find(item => item.id === line.id)!
    expect(restoredLine.parentHistory?.map(entry => [entry.effectiveAt, entry.parentLineId])).toEqual([
      [null, null],
      ['2010-01-01', 'line-a'],
      ['2020-01-01', null],
      ['2030-01-01', 'line-b'],
    ])
    expect(restoredLine.parentLineId).toBe('line-b')
  })

  it('compiles LINE_PARENT_CHANGE events for join and leave dates', () => {
    const events = compileHistoryEvents(projectWithHistory())
    const parentEvents = events.filter(event => event.type === 'LINE_PARENT_CHANGE')
    expect(parentEvents.map(event => [event.historyDate, event.lineParentChange])).toEqual([
      ['2010-01-01', { lineId: 'line-branch', newParentLineId: 'line-a' }],
      ['2020-01-01', { lineId: 'line-branch', oldParentLineId: 'line-a' }],
    ])
  })

  it('materializes a date-specific parent snapshot without mutating source data', () => {
    const project = projectWithHistory()
    const snapshot = projectWithLineParentsAt(project, '2015-01-01')
    expect(snapshot.lines.find(item => item.id === 'line-branch')?.parentLineId).toBe('line-a')
    expect(project.lines.find(item => item.id === 'line-branch')?.parentLineId).toBeUndefined()
  })

  it('does not mutate the project when a parent-history edit is rejected', () => {
    const project = projectWithHistory()
    project.lines.push({
      id: 'line-subbranch',
      name: '子支线',
      color: '#000',
      parentLineId: 'line-branch',
      stationSequence: ['s1'],
      lineOrder: 4,
      visible: true,
      locked: false,
    })
    const before = structuredClone(project)
    expect(() => updateLineParentHistoryEntry(project, 'line-a', {
      id: 'cycle',
      effectiveAt: '2015-01-01',
      parentLineId: 'line-subbranch',
    })).toThrow('循环')
    expect(project).toEqual(before)
  })

  it('clears surviving historical references to a deleted former parent line', () => {
    const project = projectWithHistory()
    const next = deleteLineAndOrphans(project, 'line-a')
    const branch = next.lines.find(item => item.id === 'line-branch')!
    expect(branch).toBeTruthy()
    expect(branch.parentHistory?.map(entry => [entry.effectiveAt, entry.parentLineId])).toEqual([
      [null, null],
      ['2010-01-01', null],
      ['2020-01-01', null],
    ])
    expect(validateLineParentHistory(next)).toEqual([])
  })
})
