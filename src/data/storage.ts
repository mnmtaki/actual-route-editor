import { demoProject } from './demo'
import type { ActualRouteProject } from './model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from './model'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

export const STORAGE_KEY = 'actual-route-editor.project.v1'

export function createEmptyProject(): ActualRouteProject {
  const today = new Date().toISOString().slice(0, 10)
  return {
    version: 1,
    name: '未命名实际走向工程',
    stations: [],
    lines: [],
    stationLineRelations: [],
    openingPhases: [],
    geometry: { segments: [] },
    mapElements: [],
    background: null,
    timeline: { currentDate: today, startDate: today, endDate: today, playing: false },
    presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: today, endDate: today },
    settings: { ...DEFAULT_SETTINGS },
  }
}

export function loadInitialProject(storage: Pick<Storage, 'getItem' | 'removeItem'> | null = getBrowserStorage()): ActualRouteProject {
  if (!storage) return createEmptyProject()
  try {
    const saved = storage.getItem(STORAGE_KEY)
    return saved ? parseProjectJson(saved) : structuredCloneSafe(demoProject)
  } catch {
    try { storage.removeItem(STORAGE_KEY) } catch { /* storage may be blocked under file:// */ }
    return createEmptyProject()
  }
}

export function saveProjectToStorage(project: ActualRouteProject, storage: Pick<Storage, 'setItem'> | null = getBrowserStorage()): boolean {
  if (!storage) return false
  try { storage.setItem(STORAGE_KEY, serializeProject(project)); return true } catch { return false }
}

function getBrowserStorage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function structuredCloneSafe<T>(value: T): T {
  return typeof globalThis.structuredClone === 'function' ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value)) as T
}
