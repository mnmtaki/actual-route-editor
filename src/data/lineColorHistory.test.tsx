import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getEffectiveLineColor } from './lineIdentity'
import { getLineOwnColorAt, projectWithLineColorsAt, removeLineColorHistoryEntry, setCurrentLineOwnColor, syncLineColorFromHistory, updateLineColorHistoryEntry } from './lineColorHistory'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compileHistoryEvents, compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'

function projectWithColorHistory() {
  const project = structuredClone(demoProject)
  const line = project.lines.find(item => item.id === 'line-b')!
  line.color = '#7c3aed'
  line.colorHistory = [
    { id: 'base', effectiveAt: null, color: '#7c3aed' },
    { id: 'green', effectiveAt: '2015-01-01', color: '#16a34a' },
    { id: 'blue', effectiveAt: '2025-01-01', color: '#2563eb' },
  ]
  line.parentHistory = [
    { id: 'parent-base', effectiveAt: null, parentLineId: null },
    { id: 'join', effectiveAt: '2010-01-01', parentLineId: 'line-a' },
    { id: 'leave', effectiveAt: '2020-01-01', parentLineId: null },
  ]
  syncLineColorFromHistory(line)
  project.presentation = { ...project.presentation, startDate: '2000-01-01', endDate: '2030-01-01', cameraMode: 'fixed' }
  return project
}

describe('line color history', () => {
  it('resolves a line own color at historical dates while keeping current color synced', () => {
    const project = projectWithColorHistory()
    const line = project.lines.find(item => item.id === 'line-b')!
    expect(line.color).toBe('#2563eb')
    expect(getLineOwnColorAt(line, '2005-01-01')).toBe('#7c3aed')
    expect(getLineOwnColorAt(line, '2018-01-01')).toBe('#16a34a')
    expect(getLineOwnColorAt(line, '2026-01-01')).toBe('#2563eb')
  })

  it('combines own color history with historical parent inheritance', () => {
    const project = projectWithColorHistory()
    const line = project.lines.find(item => item.id === 'line-b')!
    const main = project.lines.find(item => item.id === 'line-a')!
    expect(getEffectiveLineColor(project, line, '2005-01-01')).toBe('#7c3aed')
    expect(getEffectiveLineColor(project, line, '2015-01-01')).toBe(getEffectiveLineColor(project, main, '2015-01-01'))
    expect(getEffectiveLineColor(project, line, '2019-12-31')).toBe(getEffectiveLineColor(project, main, '2019-12-31'))
    expect(getEffectiveLineColor(project, line, '2020-01-01')).toBe('#16a34a')
    expect(getEffectiveLineColor(project, line, '2026-01-01')).toBe('#2563eb')
  })

  it('edits and removes color history without losing the baseline', () => {
    const project = projectWithColorHistory()
    const line = project.lines.find(item => item.id === 'line-b')!
    setCurrentLineOwnColor(line, '#f97316')
    expect(line.color).toBe('#f97316')
    expect(line.colorHistory?.at(-1)?.color).toBe('#f97316')
    removeLineColorHistoryEntry(line, 'blue')
    expect(line.color).toBe('#16a34a')
    removeLineColorHistoryEntry(line, 'green')
    expect(line.colorHistory).toBeUndefined()
    expect(line.color).toBe('#7c3aed')
  })

  it('rejects duplicate-date and empty color changes', () => {
    const project = projectWithColorHistory()
    const line = project.lines.find(item => item.id === 'line-b')!
    expect(() => updateLineColorHistoryEntry(line, { id: 'dup', effectiveAt: '2015-01-01', color: '#111111' })).toThrow('同一天')
    expect(() => updateLineColorHistoryEntry(line, { id: 'empty', effectiveAt: '2022-01-01', color: '   ' })).toThrow('不能为空')
  })

  it('round-trips color history through native JSON', () => {
    const restored = parseProjectJson(serializeProject(projectWithColorHistory()))
    const line = restored.lines.find(item => item.id === 'line-b')!
    expect(line.colorHistory?.map(entry => [entry.effectiveAt, entry.color])).toEqual([
      [null, '#7c3aed'],
      ['2015-01-01', '#16a34a'],
      ['2025-01-01', '#2563eb'],
    ])
    expect(line.color).toBe('#2563eb')
  })

  it('compiles LINE_COLOR_CHANGE events for every dated color change', () => {
    const events = compileHistoryEvents(projectWithColorHistory()).filter(event => event.type === 'LINE_COLOR_CHANGE')
    expect(events.map(event => [event.historyDate, event.lineColorChange])).toEqual([
      ['2015-01-01', { lineId: 'line-b', oldColor: '#7c3aed', newColor: '#16a34a' }],
      ['2025-01-01', { lineId: 'line-b', oldColor: '#16a34a', newColor: '#2563eb' }],
    ])
  })

  it('materializes line own colors for date-blind badge and legend renderers', () => {
    const project = projectWithColorHistory()
    const snapshot = projectWithLineColorsAt(project, '2018-01-01')
    expect(snapshot.lines.find(item => item.id === 'line-b')?.color).toBe('#16a34a')
    expect(project.lines.find(item => item.id === 'line-b')?.color).toBe('#2563eb')
  })

  it('renders the historical effective color in Presentation', () => {
    const project = projectWithColorHistory()
    const line = project.lines.find(item => item.id === 'line-b')!
    line.lineBadges = [{ id: 'badge-b', x: 320, y: 240, size: 42, rotation: 0, visible: true }]
    const sequence = compilePresentation(project)
    const colorBeat = sequence.beats.find(beat => beat.type === 'LINE_COLOR_CHANGE' && beat.historyDate === '2025-01-01')!
    const view = render(<PresentationScene project={project} sequence={sequence} time={colorBeat.revealStart + .01} width={1280} height={720} />)
    const badge = view.container.querySelector('[data-line-badge-id="badge-b"]')
    expect(badge?.querySelector('rect')?.getAttribute('fill')).toBe('#2563eb')
    expect(view.container.querySelector('svg.presentation-scene')?.outerHTML).not.toMatch(/\bNaN\b|\bInfinity\b/)
  })
})
