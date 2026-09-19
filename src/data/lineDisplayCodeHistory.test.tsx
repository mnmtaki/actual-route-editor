import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import {
  getLineDisplayCodeAt,
  normalizeLineDisplayCodeHistory,
  projectWithLineDisplayCodesAt,
  removeLineDisplayCodeHistoryEntry,
  setCurrentLineDisplayCode,
  syncLineDisplayCodeFromHistory,
  updateLineDisplayCodeHistoryEntry,
} from './lineDisplayCodeHistory'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compileHistoryEvents, compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'

function projectWithDisplayCodeHistory() {
  const project = structuredClone(demoProject)
  const line = project.lines.find(item => item.id === 'line-a')!
  line.displayCode = 'A'
  line.displayCodeHistory = [
    { id: 'base', effectiveAt: null, displayCode: 'A' },
    { id: 'one', effectiveAt: '2010-01-01', displayCode: '1' },
    { id: 'm1', effectiveAt: '2020-01-01', displayCode: 'M1' },
  ]
  syncLineDisplayCodeFromHistory(line)
  const station = project.stations.find(item => item.id === 's1')!
  station.stationStyleId = 'station.guangzhou.basic'
  const relation = project.stationLineRelations.find(item => item.stationId === 's1' && item.lineId === 'line-a')!
  relation.stationCode = '01'
  project.presentation = { ...project.presentation, startDate: '2000-01-01', endDate: '2025-01-01', cameraMode: 'fixed' }
  return project
}

describe('line display code history', () => {
  it('resolves the passenger-facing line code at historical dates and syncs the current code', () => {
    const project = projectWithDisplayCodeHistory()
    const line = project.lines.find(item => item.id === 'line-a')!
    expect(line.displayCode).toBe('M1')
    expect(getLineDisplayCodeAt(line, '2005-01-01')).toBe('A')
    expect(getLineDisplayCodeAt(line, '2015-01-01')).toBe('1')
    expect(getLineDisplayCodeAt(line, '2024-01-01')).toBe('M1')
  })

  it('keeps legacy number/code/shortName/name fallbacks when no history exists', () => {
    const line = structuredClone(demoProject.lines[0])
    line.number = '01'
    expect(getLineDisplayCodeAt(line, '2005-01-01')).toBe('01')
    delete line.number
    line.code = 'L1'
    expect(getLineDisplayCodeAt(line, '2005-01-01')).toBe('L1')
    delete line.code
    line.shortName = 'A'
    expect(getLineDisplayCodeAt(line, '2005-01-01')).toBe('A')
    delete line.shortName
    line.name = '12号线'
    expect(getLineDisplayCodeAt(line, '2005-01-01')).toBe('12')
  })

  it('edits and removes code history without losing its baseline', () => {
    const project = projectWithDisplayCodeHistory()
    const line = project.lines.find(item => item.id === 'line-a')!
    setCurrentLineDisplayCode(line, 'R1')
    expect(line.displayCode).toBe('R1')
    expect(line.displayCodeHistory?.at(-1)?.displayCode).toBe('R1')
    removeLineDisplayCodeHistoryEntry(line, 'm1')
    expect(line.displayCode).toBe('1')
    removeLineDisplayCodeHistoryEntry(line, 'one')
    expect(line.displayCodeHistory).toBeUndefined()
    expect(line.displayCode).toBe('A')
  })

  it('rejects duplicate dates and empty display codes', () => {
    const line = projectWithDisplayCodeHistory().lines.find(item => item.id === 'line-a')!
    expect(() => updateLineDisplayCodeHistoryEntry(line, { id: 'dup', effectiveAt: '2010-01-01', displayCode: 'X' })).toThrow('同一天')
    expect(() => updateLineDisplayCodeHistoryEntry(line, { id: 'empty', effectiveAt: '2018-01-01', displayCode: '   ' })).toThrow('不能为空')
  })

  it('normalizes duplicate dates deterministically and keeps a baseline', () => {
    const line = structuredClone(demoProject.lines[0])
    line.displayCode = 'A'
    line.displayCodeHistory = [
      { id: 'z', effectiveAt: '2010-01-01', displayCode: 'Z' },
      { id: 'a', effectiveAt: '2010-01-01', displayCode: 'A1' },
    ]
    expect(normalizeLineDisplayCodeHistory(line)).toEqual([
      { id: 'display-code-base-line-a', effectiveAt: null, displayCode: 'A' },
      { id: 'a', effectiveAt: '2010-01-01', displayCode: 'A1' },
    ])
  })

  it('round-trips code history through native JSON', () => {
    const restored = parseProjectJson(serializeProject(projectWithDisplayCodeHistory()))
    const line = restored.lines.find(item => item.id === 'line-a')!
    expect(line.displayCodeHistory?.map(entry => [entry.effectiveAt, entry.displayCode])).toEqual([
      [null, 'A'],
      ['2010-01-01', '1'],
      ['2020-01-01', 'M1'],
    ])
    expect(line.displayCode).toBe('M1')
  })

  it('compiles code changes as pure identity events', () => {
    const events = compileHistoryEvents(projectWithDisplayCodeHistory()).filter(event => event.type === 'LINE_DISPLAY_CODE_CHANGE')
    expect(events.map(event => [event.historyDate, event.lineDisplayCodeChange])).toEqual([
      ['2010-01-01', { lineId: 'line-a', oldDisplayCode: 'A', newDisplayCode: '1' }],
      ['2020-01-01', { lineId: 'line-a', oldDisplayCode: '1', newDisplayCode: 'M1' }],
    ])
  })

  it('materializes historical codes without mutating the source project', () => {
    const project = projectWithDisplayCodeHistory()
    const snapshot = projectWithLineDisplayCodesAt(project, '2015-01-01')
    expect(snapshot.lines.find(item => item.id === 'line-a')?.displayCode).toBe('1')
    expect(project.lines.find(item => item.id === 'line-a')?.displayCode).toBe('M1')
  })

  it('renders the historical code in Presentation station artwork', () => {
    const project = projectWithDisplayCodeHistory()
    const sequence = compilePresentation(project)
    const codeBeat = sequence.beats.find(beat => beat.type === 'LINE_DISPLAY_CODE_CHANGE' && beat.historyDate === '2010-01-01')!
    const view = render(<PresentationScene project={project} sequence={sequence} time={codeBeat.revealStart + .0005} width={1280} height={720} />)
    const pill = view.container.querySelector('[data-station-artwork="s1"] [data-guangzhou-pill="true"]')
    expect(pill?.getAttribute('data-guangzhou-pill-line-code')).toBe('1')
    expect(view.container.querySelector('svg.presentation-scene')?.outerHTML).not.toMatch(/\bNaN\b|\bInfinity\b/)
  })
})
