import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './model'
import { createEmptyProject, loadInitialProject, saveProjectToStorage, STORAGE_KEY } from './storage'

describe('project storage recovery', () => {
  it('falls back to an empty project when cached JSON is corrupted', () => {
    const removeItem = vi.fn()
    const project = loadInitialProject({ getItem: () => '{broken', removeItem })
    expect(project).toEqual(expect.objectContaining({ stations: [], lines: [], stationLineRelations: [] }))
    expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY)
  })

  it('does not crash when localStorage access itself is blocked', () => {
    const project = loadInitialProject({ getItem: () => { throw new DOMException('blocked', 'SecurityError') }, removeItem: () => { throw new DOMException('blocked', 'SecurityError') } })
    expect(project.name).toBe(createEmptyProject().name)
  })

  it('normalizes an older version-1 project with missing optional fields', () => {
    const old = JSON.stringify({ version: 1, name: '旧工程', stations: [], lines: [], geometry: { segments: [] } })
    const project = loadInitialProject({ getItem: () => old, removeItem: vi.fn() })
    expect(project.settings).toEqual(DEFAULT_SETTINGS)
    expect(project.stationLineRelations).toEqual([])
    expect(project.timeline.playing).toBe(false)
  })

  it('contains autosave failures instead of throwing', () => {
    expect(saveProjectToStorage(createEmptyProject(), { setItem: () => { throw new DOMException('blocked', 'SecurityError') } })).toBe(false)
  })
})
