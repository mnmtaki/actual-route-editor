import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getStationNameAt, removeStationNameHistoryEntry, syncStationNameFromHistory, updateStationNameHistoryEntry } from './stationNameHistory'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compileHistoryEvents, compilePresentation } from '../presentation/compiler'
import { getPresentationState } from '../presentation/engine'
import { PresentationScene } from '../presentation/PresentationScene'

function renamedProject() {
  const project = structuredClone(demoProject)
  const station = project.stations.find(item => item.id === 's1')!
  station.nameHistory = [
    { id: 'base', effectiveAt: null, name: '云港旧站', nameS: 'Old Cloudport' },
    { id: 'rename-2010', effectiveAt: '2010-01-01', name: '云港', nameS: 'Cloudport' },
    { id: 'rename-2020', effectiveAt: '2020-01-01', name: '云港中心', nameS: 'Cloudport Central' },
  ]
  syncStationNameFromHistory(station)
  project.presentation = { ...project.presentation, startDate: '2000-01-01', endDate: '2020-01-01', cameraMode: 'fixed' }
  return project
}

describe('Station Name History', () => {
  it('keeps legacy stations on their current name when no history exists', () => {
    const station = structuredClone(demoProject.stations[0])
    expect(getStationNameAt(station, '1900-01-01')).toEqual({ name: '云港' })
  })

  it('resolves baseline and multiple dated Chinese/foreign names at inclusive boundaries', () => {
    const station = renamedProject().stations[0]
    expect(getStationNameAt(station, '2009-12-31')).toEqual({ name: '云港旧站', nameS: 'Old Cloudport' })
    expect(getStationNameAt(station, '2010-01-01')).toEqual({ name: '云港', nameS: 'Cloudport' })
    expect(getStationNameAt(station, '2026-01-01')).toEqual({ name: '云港中心', nameS: 'Cloudport Central' })
  })

  it('synchronizes the current station name and returns to baseline when the final rename is deleted', () => {
    const station = renamedProject().stations[0]
    expect(station.name).toBe('云港中心')
    updateStationNameHistoryEntry(station, { id: 'rename-2025', effectiveAt: '2025-01-01', name: '新云港', nameS: 'New Cloudport' })
    expect(station.name).toBe('新云港')
    removeStationNameHistoryEntry(station, 'rename-2025')
    removeStationNameHistoryEntry(station, 'rename-2020')
    removeStationNameHistoryEntry(station, 'rename-2010')
    expect(station.nameHistory).toBeUndefined()
    expect(station.name).toBe('云港旧站')
  })

  it('round-trips history, keeps AARC-compatible current fields, and rejects same-date changes', () => {
    const project = renamedProject(), restored = parseProjectJson(serializeProject(project)), station = restored.stations[0]
    expect(station.nameHistory).toHaveLength(3)
    expect(station.name).toBe('云港中心')
    expect(() => updateStationNameHistoryEntry(station, { id: 'duplicate', effectiveAt: '2020-01-01', name: '重复' })).toThrow('同一天')
  })

  it('compiles deterministic rename events without changing opening statistics or relation caches', () => {
    const project = renamedProject(), events = compileHistoryEvents(project), rename = events.filter(event => event.type === 'STATION_RENAME')
    expect(rename.map(event => event.historyDate)).toEqual(['2010-01-01', '2020-01-01'])
    expect(rename[0].stationNameChange).toMatchObject({ stationId: 's1', oldName: '云港旧站', newName: '云港' })
    expect(rename.every(event => !event.segmentIds.length && !event.stationIds.length && !event.interchangeStationIds.length)).toBe(true)
    expect(events.filter(event => event.historyDate === '2010-01-01').map(event => event.type)).toEqual(['LINE_OPENING', 'STATION_RENAME'])
  })

  it('uses the same resolved labels in presentation and preserves the opening HUD through a rename beat', () => {
    const project = renamedProject(), sequence = compilePresentation(project), renameBeat = sequence.beats.find(beat => beat.type === 'STATION_RENAME' && beat.historyDate === '2010-01-01')!
    const before = getPresentationState(project, sequence, renameBeat.presentationStart - .001)
    const during = getPresentationState(project, sequence, renameBeat.revealStart + .01)
    expect(before.statistics).toEqual(during.statistics)
    expect(getPresentationState(project, sequence, renameBeat.revealStart + .01)).toEqual(during)
    const { container } = render(<PresentationScene project={project} sequence={sequence} time={renameBeat.revealStart + .01} width={1920} height={1080} />)
    expect(container.textContent).toContain('云港')
    expect(container.textContent).not.toContain('云港旧站')
    expect(container.querySelector('.presentation-current-opening')).toBeTruthy()
  })
})
