import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getLineNameAt, removeLineNameHistoryEntry, setCurrentLineName, syncLineNameFromHistory, updateLineNameHistoryEntry } from './lineNameHistory'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compileHistoryEvents, compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'

function renamedProject() {
  const project = structuredClone(demoProject)
  const line = project.lines.find(item => item.id === 'line-a')!
  line.nameHistory = [
    { id: 'base', effectiveAt: null, name: '老城线' },
    { id: 'rename-2010', effectiveAt: '2010-01-01', name: '澄川线' },
    { id: 'rename-2015', effectiveAt: '2015-01-01', name: '中央线' },
  ]
  line.lineBadges = [{ id: 'badge-a', x: 240, y: 390, size: 42, rotation: 0, visible: true }]
  syncLineNameFromHistory(line)
  project.presentation = { ...project.presentation, startDate: '2000-01-01', endDate: '2020-01-01', cameraMode: 'fixed' }
  return project
}

describe('Line Name History', () => {
  it('keeps legacy lines on their current name when no history exists', () => {
    const line = structuredClone(demoProject.lines[0])
    expect(getLineNameAt(line, '1900-01-01')).toEqual({ name: '澄川线' })
  })

  it('resolves baseline and multiple dated names at inclusive boundaries', () => {
    const line = renamedProject().lines.find(item => item.id === 'line-a')!
    expect(getLineNameAt(line, '2009-12-31').name).toBe('老城线')
    expect(getLineNameAt(line, '2010-01-01').name).toBe('澄川线')
    expect(getLineNameAt(line, '2026-01-01').name).toBe('中央线')
  })

  it('synchronizes the current name, edits the latest entry, and returns to baseline when renames are removed', () => {
    const line = renamedProject().lines.find(item => item.id === 'line-a')!
    expect(line.name).toBe('中央线')
    setCurrentLineName(line, '中央快线')
    expect(line.name).toBe('中央快线')
    expect(line.nameHistory?.at(-1)?.name).toBe('中央快线')
    removeLineNameHistoryEntry(line, 'rename-2015')
    removeLineNameHistoryEntry(line, 'rename-2010')
    expect(line.nameHistory).toBeUndefined()
    expect(line.name).toBe('老城线')
  })

  it('round-trips history and rejects duplicate-date or empty-name changes', () => {
    const project = renamedProject()
    const restored = parseProjectJson(serializeProject(project))
    const line = restored.lines.find(item => item.id === 'line-a')!
    expect(line.nameHistory).toHaveLength(3)
    expect(line.name).toBe('中央线')
    expect(() => updateLineNameHistoryEntry(line, { id: 'duplicate', effectiveAt: '2015-01-01', name: '重复' })).toThrow('同一天')
    expect(() => updateLineNameHistoryEntry(line, { id: 'empty', effectiveAt: '2018-01-01', name: '   ' })).toThrow('不能为空')
  })

  it('compiles deterministic LINE_RENAME events without changing topology payloads', () => {
    const events = compileHistoryEvents(renamedProject())
    const renames = events.filter(event => event.type === 'LINE_RENAME')
    expect(renames.map(event => event.historyDate)).toEqual(['2010-01-01', '2015-01-01'])
    expect(renames[0].lineNameChange).toEqual({ lineId: 'line-a', oldName: '老城线', newName: '澄川线' })
    expect(renames[1].lineNameChange).toEqual({ lineId: 'line-a', oldName: '澄川线', newName: '中央线' })
    expect(renames.every(event => !event.segmentIds.length && !event.stationIds.length && !event.interchangeStationIds.length)).toBe(true)
  })

  it('renders historical line names in Presentation badges, legend-facing project data, HUD, and statistics', () => {
    const project = renamedProject()
    const sequence = compilePresentation(project)
    const renameBeat = sequence.beats.find(beat => beat.type === 'LINE_RENAME' && beat.historyDate === '2015-01-01')!
    const before = render(<PresentationScene project={project} sequence={sequence} time={Math.max(0, renameBeat.presentationStart - .001)} width={1280} height={720} />)
    expect(before.container.textContent).toContain('澄川线')
    expect(before.container.textContent).not.toContain('中央线')
    before.unmount()

    const during = render(<PresentationScene project={project} sequence={sequence} time={renameBeat.revealStart + .01} width={1280} height={720} />)
    expect(during.container.textContent).toContain('中央线')
    expect(during.container.textContent).not.toContain('老城线')
    expect(during.container.querySelector('[data-line-badge-id="badge-a"]')?.textContent).toContain('中央线')
  })
})
