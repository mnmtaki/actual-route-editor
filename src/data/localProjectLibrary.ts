import type { ActualRouteProject } from './model'
import { getProjectName, normalizeProjectName } from './projectMetadata'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

const DATABASE_NAME = 'actual-route-editor.local-projects.v1'
const STORE_NAME = 'projects'
const ACTIVE_TAB_KEY = 'actual-route-editor.active-local-project.v1'

export interface LocalProjectSummary {
  id: string
  name: string
  updatedAt: number
  stations: number
  lines: number
  revision: number
}

interface StoredLocalProject extends LocalProjectSummary {
  data: string
}

export interface LoadedLocalProject {
  id: string
  revision: number
  project: ActualRouteProject
}

const fail = (reason: string) => new Error(reason)
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? fail('本地数据库读取失败'))
  })
}

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw fail('当前环境不支持 IndexedDB')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? fail('无法打开本地工程库'))
    request.onblocked = () => reject(fail('本地工程库被其他页面阻塞，请关闭其他标签页后重试'))
  })
}

async function readAll(): Promise<StoredLocalProject[]> {
  const db = await database()
  try {
    return await requestResult<StoredLocalProject[]>(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll())
  } finally {
    db.close()
  }
}

export async function listLocalProjects(): Promise<LocalProjectSummary[]> {
  return (await readAll()).map(({ id, name, updatedAt, stations, lines, revision }) =>
    ({ id, name, updatedAt, stations, lines, revision })
  ).sort((a, b) => b.updatedAt - a.updatedAt)
}

function readActiveId(): string | null {
  try { return sessionStorage.getItem(ACTIVE_TAB_KEY) } catch { return null }
}

export function rememberActiveLocalProject(id: string): void {
  try { sessionStorage.setItem(ACTIVE_TAB_KEY, id) } catch { /* private mode */ }
}

export async function loadLocalProject(id: string): Promise<LoadedLocalProject> {
  const db = await database()
  let saved: StoredLocalProject | undefined
  try {
    saved = await requestResult<StoredLocalProject | undefined>(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id))
  } finally {
    db.close()
  }
  if (!saved) throw fail('找不到指定工程，可能已在其他窗口删除')
  try {
    return { id, revision: saved.revision, project: parseProjectJson(saved.data) }
  } catch {
    throw fail('工程数据损坏，已保留原始记录；请勿覆盖，可以尝试导出旧 JSON 备份')
  }
}

function recordFor(id: string, project: ActualRouteProject, revision: number): StoredLocalProject {
  return {
    id, name: getProjectName(project), revision,
    updatedAt: Date.now(), stations: project.stations.length, lines: project.lines.length,
    data: serializeProject(project),
  }
}

export async function createLocalProject(project: ActualRouteProject): Promise<LoadedLocalProject> {
  const saved = recordFor(makeId(), project, 1)
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).add(saved)
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? fail('工程创建失败，可能是浏览器存储空间不足'))
      tx.onerror = () => reject(tx.error ?? fail('工程创建失败'))
    })
  } finally {
    db.close()
  }
  return { id: saved.id, revision: 1, project }
}

/** Compare-and-swap guards against silently overwriting edits from another tab. */
export async function saveLocalProject(id: string, project: ActualRouteProject, expectedRevision: number): Promise<number> {
  const db = await database()
  const saved = recordFor(id, project, expectedRevision + 1)
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const request = tx.objectStore(STORE_NAME).get(id)
      request.onsuccess = () => {
        const current = request.result as StoredLocalProject | undefined
        if (!current || current.revision !== expectedRevision) {
          reject(fail('工程已在另一窗口修改或删除。为防止覆盖，请先导出当前 JSON，再重新打开工程。'))
          tx.abort()
          return
        }
        tx.objectStore(STORE_NAME).put(saved)
      }
      tx.oncomplete = () => resolve(saved.revision)
      tx.onabort = () => reject(tx.error ?? fail('本地保存失败，可能是工程发生冲突或存储空间不足'))
      tx.onerror = () => reject(tx.error ?? fail('本地保存失败'))
    })
  } finally {
    db.close()
  }
}

export async function deleteLocalProject(id: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? fail('删除工程失败'))
      tx.onerror = () => reject(tx.error ?? fail('删除工程失败'))
    })
  } finally {
    db.close()
  }
}

export async function renameLocalProject(id: string, name: string): Promise<LoadedLocalProject> {
  const loaded = await loadLocalProject(id)
  const title = normalizeProjectName(name)
  const next = { ...loaded.project, name: title, projectName: title }
  const revision = await saveLocalProject(id, next, loaded.revision)
  return { id, revision, project: next }
}

let initialization: Promise<LoadedLocalProject> | undefined

/**
 * Import the old single-slot snapshot only if the new database is empty.
 * Never remove the legacy localStorage value: it remains a recovery backup.
 */
export function initializeLocalProjects(legacyProject: ActualRouteProject): Promise<LoadedLocalProject> {
  initialization ??= (async () => {
    const existing = await listLocalProjects()
    if (!existing.length) {
      const created = await createLocalProject(legacyProject)
      rememberActiveLocalProject(created.id)
      return created
    }
    const preferred = readActiveId()
    const selected = existing.find(item => item.id === preferred) ?? existing[0]
    const loaded = await loadLocalProject(selected.id)
    rememberActiveLocalProject(loaded.id)
    return loaded
  })().catch(error => {
    initialization = undefined
    throw error
  })
  return initialization
}
