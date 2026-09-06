import type { ActualRouteProject } from './model'

export const DEFAULT_PROJECT_NAME = '未命名工程'

export function normalizeProjectName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PROJECT_NAME
  const normalized = value.trim()
  return normalized || DEFAULT_PROJECT_NAME
}

export function getProjectName(project: Pick<ActualRouteProject, 'projectName' | 'name'>): string {
  const explicit = typeof project.projectName === 'string' ? project.projectName.trim() : ''
  if (explicit) return explicit
  const legacy = typeof project.name === 'string' ? project.name.trim() : ''
  return legacy || DEFAULT_PROJECT_NAME
}

export function sanitizeFilenameStem(value: unknown): string {
  const normalized = normalizeProjectName(value)
  const safe = normalized.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return safe || DEFAULT_PROJECT_NAME
}

export function projectFilename(project: Pick<ActualRouteProject, 'projectName' | 'name'>, suffix: string): string {
  return `${sanitizeFilenameStem(getProjectName(project))}${suffix}`
}
