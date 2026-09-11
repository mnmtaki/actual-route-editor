import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { createEmptyProject } from './storage'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import {
  assignStationStyle,
  createDefaultStationStyle,
  createStationStyle,
  deleteStationStyle,
  getStationStyles,
  normalizeStationStyle,
  resolveStationStyle,
  setProjectDefaultStationStyle,
  updateStationStyle,
} from './stationStyles'

describe('ordinary station style registry', () => {
  it('migrates a legacy project to a default style without changing the configured size', () => {
    const project = structuredClone(demoProject)
    delete project.stationStyles
    delete project.defaultStationStyleId
    project.settings.stationSize = 14
    expect(resolveStationStyle(project, project.stations[0])).toMatchObject({ id: 'default', width: 14, height: 14, shape: 'circle' })
    expect(getStationStyles(project)).toHaveLength(1)
  })

  it('keeps a new empty project ready with one built-in default style', () => {
    const project = createEmptyProject()
    expect(project.stationStyles).toEqual([createDefaultStationStyle(11)])
    expect(project.defaultStationStyleId).toBe('default')
  })

  it('creates, copies, renames and deletes independent library entries', () => {
    const first = createStationStyle(structuredClone(demoProject), undefined, '重点站')
    const copied = createStationStyle(first.project, first.styleId, '重点站副本')
    const renamed = updateStationStyle(copied.project, copied.styleId, { name: '枢纽站', shape: 'diamond', width: 18, height: 24, lockAspect: false })
    expect(renamed.stationStyles).toHaveLength(3)
    expect(renamed.stationStyles?.find(style => style.id === copied.styleId)).toMatchObject({ name: '枢纽站', shape: 'diamond', width: 18, height: 24 })
    const deleted = deleteStationStyle(renamed, first.styleId)
    expect(deleted.stationStyles?.some(style => style.id === first.styleId)).toBe(false)
  })

  it('uses the project default and falls back safely for dangling references', () => {
    const created = createStationStyle(structuredClone(demoProject), undefined, '枢纽')
    const project = setProjectDefaultStationStyle(created.project, created.styleId)
    expect(resolveStationStyle(project, project.stations[0]).id).toBe(created.styleId)
    project.stations[0].stationStyleId = 'missing-style'
    expect(resolveStationStyle(project, project.stations[0]).id).toBe(created.styleId)
    project.defaultStationStyleId = 'missing-default'
    expect(resolveStationStyle(project, project.stations[0]).id).toBe('default')
  })

  it('applies and clears one style reference for a batch of stations', () => {
    const created = createStationStyle(structuredClone(demoProject), undefined, '重点站')
    const applied = assignStationStyle(created.project, ['s1', 's3'], created.styleId)
    expect(applied.stations.filter(station => ['s1', 's3'].includes(station.id)).every(station => station.stationStyleId === created.styleId)).toBe(true)
    const cleared = assignStationStyle(applied, ['s1', 's3'])
    expect(cleared.stations.filter(station => ['s1', 's3'].includes(station.id)).every(station => station.stationStyleId === undefined)).toBe(true)
  })

  it('deleting a referenced style returns stations to the project default', () => {
    const created = createStationStyle(structuredClone(demoProject), undefined, '重点站')
    const applied = assignStationStyle(created.project, ['s1'], created.styleId)
    const deleted = deleteStationStyle(applied, created.styleId)
    expect(deleted.stations.find(station => station.id === 's1')?.stationStyleId).toBeUndefined()
    expect(resolveStationStyle(deleted, deleted.stations[0]).id).toBe('default')
  })

  it('round-trips the style library, default and station assignment', () => {
    const created = createStationStyle(structuredClone(demoProject), undefined, '重点站')
    const project = setProjectDefaultStationStyle(assignStationStyle(created.project, ['s1'], created.styleId), created.styleId)
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.defaultStationStyleId).toBe(created.styleId)
    expect(restored.stations.find(station => station.id === 's1')?.stationStyleId).toBe(created.styleId)
    expect(restored.stationStyles?.map(style => style.id)).toEqual(project.stationStyles?.map(style => style.id))
    expect(resolveStationStyle(restored, restored.stations[0]).id).toBe(created.styleId)
  })

  it('normalizes invalid values and enforces locked aspect ratio', () => {
    const normalized = normalizeStationStyle({ id: 'custom', shape: 'roundedRect', width: -4, height: 99, lockAspect: true, cornerRadius: -2, fillOpacity: 4, strokeWidth: -1, haloGap: -3 })!
    expect(normalized).toMatchObject({ width: 0.01, height: 0.01, cornerRadius: 0, fillOpacity: 1, strokeWidth: 0, haloGap: 0 })
    expect(updateStationStyle({ ...structuredClone(demoProject), stationStyles: [createDefaultStationStyle()] }, 'unknown', { width: 20 })).toBeDefined()
  })
})
