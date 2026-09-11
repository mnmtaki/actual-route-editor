import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { applyPresetToStations, BUILTIN_PRESET_REGISTRY, copyPresetToCustom, getBuiltInPresets, isPresetCompatible, presetCompatibilityMessage, setDefaultPreset } from './presetRegistry'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { setProjectDefaultTransferStyle } from './transferStyles'

describe('built-in station and transfer preset registry', () => {
  it('contains exactly the first twelve stable presets with immutable definitions', () => {
    const ids = getBuiltInPresets().map(preset => preset.id)
    expect(ids).toEqual([
      'station.actualroute.default', 'transfer.actualroute.default', 'station.shanghai.basic', 'transfer.shanghai.default',
      'station.guangzhou.basic', 'transfer.guangzhou.classic', 'transfer.guangzhou.2024', 'transfer.beijing.default',
      'transfer.kunming.two', 'transfer.kunming.three', 'station.metroman.basic', 'transfer.metroman.default',
    ])
    expect(new Set(ids).size).toBe(12)
    expect(Object.isFrozen(BUILTIN_PRESET_REGISTRY)).toBe(true)
    expect(Object.isFrozen(BUILTIN_PRESET_REGISTRY[0])).toBe(true)
    expect(getBuiltInPresets('station').every(preset => preset.applicableType === 'station')).toBe(true)
    expect(getBuiltInPresets('transfer').every(preset => preset.applicableType === 'transfer')).toBe(true)
  })

  it('exposes compatibility metadata and rejects Guangzhou classic above four services', () => {
    expect(isPresetCompatible('transfer.guangzhou.classic', 4)).toBe(true)
    expect(isPresetCompatible('transfer.guangzhou.classic', 5)).toBe(false)
    expect(presetCompatibilityMessage('transfer.guangzhou.classic', 5)).toContain('2–4')
  })

  it('keeps incompatible transfer presets from being applied to a five-service station', () => {
    const project = structuredClone(demoProject)
    const station = project.stations[1]
    const extraLines = [
      { id: 'preview-extra-1', name: '9号线', color: '#aa3344', stationSequence: [station.id], lineOrder: 20, visible: true, locked: false },
      { id: 'preview-extra-2', name: '10号线', color: '#3355aa', stationSequence: [station.id], lineOrder: 21, visible: true, locked: false },
      { id: 'preview-extra-3', name: '11号线', color: '#338855', stationSequence: [station.id], lineOrder: 22, visible: true, locked: false },
    ]
    project.lines.push(...extraLines)
    project.stationLineRelations.push(...extraLines.map((line, index) => ({ id: `preview-extra-r-${index}`, stationId: station.id, lineId: line.id, openedAt: '2000-01-01' })))
    expect(applyPresetToStations(project, [station.id], 'transfer.guangzhou.classic')).toBe(project)
  })

  it('copies a preset into a mutable project-owned style without mutating the registry', () => {
    const before = structuredClone(demoProject)
    const copied = copyPresetToCustom(before, 'station.shanghai.basic')
    expect(copied.styleId).toMatch(/^station_style_/)
    expect(copied.project.stationStyles?.some(style => style.id === copied.styleId && !style.builtin && style.template === 'sideMarker')).toBe(true)
    expect(before.stationStyles).toBeUndefined()
    expect(BUILTIN_PRESET_REGISTRY.find(item => item.id === 'station.shanghai.basic')?.stationStyle?.builtin).toBe(true)
  })

  it('applies station presets to selected objects and transfer presets to a logical compound station', () => {
    const stationApplied = applyPresetToStations(structuredClone(demoProject), ['s1'], 'station.shanghai.basic')
    expect(stationApplied.stations.find(station => station.id === 's1')?.stationStyleId).toBe('station.shanghai.basic')
    const project = structuredClone(demoProject)
    project.stations[1].compoundGroupId = 'civic'
    project.stations.push({ ...project.stations[1], id: 's2-member', compoundGroupId: 'civic', x: 392, y: 351 })
    project.stationLineRelations.push({ id: 'r-member', stationId: 's2-member', lineId: 'line-c', openedAt: '2020-01-01' })
    const transferApplied = applyPresetToStations(project, ['s2'], 'transfer.kunming.three')
    expect(transferApplied.stations.filter(station => station.compoundGroupId === 'civic').every(station => station.transferStyleId === 'transfer.kunming.three')).toBe(true)
  })

  it('round-trips built-in references and custom copies', () => {
    const copied = copyPresetToCustom(structuredClone(demoProject), 'transfer.shanghai.default')
    const next = setProjectDefaultTransferStyle(copied.project, copied.styleId)
    const restored = parseProjectJson(serializeProject(next))
    expect(restored.defaultTransferStyleId).toBe(copied.styleId)
    expect(restored.transferStyles?.some(style => style.id === copied.styleId)).toBe(true)
    const builtin = parseProjectJson(serializeProject(setDefaultPreset(restored, 'station', 'station.shanghai.basic')))
    expect(builtin.defaultStationStyleId).toBe('station.shanghai.basic')
  })
})
