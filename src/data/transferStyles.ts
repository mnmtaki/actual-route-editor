import type { ActualRouteProject, Station, TransferStyle, TransferStyleTemplate } from './model'
import { getBuiltInTransferStyle } from './presetRegistry'
import { getCompoundStationCanonical, getCompoundStationMembers } from './compoundStation'
import { uid } from './model'

export const DEFAULT_TRANSFER_STYLE_ID = 'transfer.actualroute.default'

const templates: TransferStyleTemplate[] = ['default', 'shanghai', 'guangzhouClassic', 'guangzhou2024', 'beijing', 'kunming', 'metroman']
const color = (value: unknown, fallback: string) => typeof value === 'string' && (value.trim().toLowerCase() === 'white' || /^#[0-9a-f]{6}$/i.test(value.trim())) ? value.trim().toLowerCase() : fallback
const number = (value: unknown, fallback: number, min = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, n) : fallback }

export function normalizeTransferStyle(value: unknown, fallback?: TransferStyle): TransferStyle | null {
  if (!value || typeof value !== 'object') return fallback ? { ...fallback } : null
  const raw = value as Record<string, unknown>, id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fallback?.id ?? ''
  if (!id) return fallback ? { ...fallback } : null
  const base = fallback ?? getBuiltInTransferStyle(DEFAULT_TRANSFER_STYLE_ID)!
  const template = typeof raw.template === 'string' && templates.includes(raw.template as TransferStyleTemplate) ? raw.template as TransferStyleTemplate : base.template
  const max = raw.maxServiceCount === undefined || raw.maxServiceCount === null ? base.maxServiceCount : number(raw.maxServiceCount, base.maxServiceCount ?? 0, 1)
  return {
    id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : base.name,
    template, shellFill: color(raw.shellFill, base.shellFill), shellStroke: color(raw.shellStroke, base.shellStroke), shellStrokeWidth: number(raw.shellStrokeWidth, base.shellStrokeWidth),
    dotsVisible: raw.dotsVisible === true,
    minServiceCount: number(raw.minServiceCount, base.minServiceCount, 1),
    ...(max !== undefined && max > 0 ? { maxServiceCount: max } : {}),
    ...(raw.recommendedServiceCount !== undefined ? { recommendedServiceCount: number(raw.recommendedServiceCount, base.recommendedServiceCount ?? 0, 1) } : base.recommendedServiceCount !== undefined ? { recommendedServiceCount: base.recommendedServiceCount } : {}),
    ...(id.startsWith('transfer.') ? { builtin: true } : {}),
  }
}

export function normalizeTransferStyles(value: unknown): TransferStyle[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: TransferStyle[] = []
  for (const item of value) {
    const style = normalizeTransferStyle(item)
    if (!style || result.some(existing => existing.id === style.id)) continue
    result.push(style)
  }
  return result.length ? result : undefined
}

export function getTransferStyles(project: ActualRouteProject): TransferStyle[] {
  const saved = Array.isArray(project.transferStyles) ? project.transferStyles : []
  return saved.flatMap(item => { const normalized = normalizeTransferStyle(item); return normalized ? [normalized] : [] })
}

export function getTransferStyleOptions(project: ActualRouteProject): TransferStyle[] {
  return [...getTransferStyles(project), ...[]]
}

export function resolveTransferStyle(project: ActualRouteProject, stationOrId: Station | string): TransferStyle {
  const station = typeof stationOrId === 'string' ? project.stations.find(item => item.id === stationOrId) : stationOrId
  const canonical = station ? getCompoundStationCanonical(project, station) : undefined
  const memberOverride = station
    ? getCompoundStationMembers(project, station).find(member => typeof member.transferStyleId === 'string')?.transferStyleId
    : undefined
  const selectedId = canonical?.transferStyleId ?? memberOverride ?? station?.transferStyleId ?? project.defaultTransferStyleId ?? DEFAULT_TRANSFER_STYLE_ID
  const saved = getTransferStyles(project).find(style => style.id === selectedId)
  return saved ?? getBuiltInTransferStyle(selectedId) ?? getBuiltInTransferStyle(DEFAULT_TRANSFER_STYLE_ID)!
}

export function assignTransferStyle(project: ActualRouteProject, stationIds: string[], styleId?: string): ActualRouteProject {
  const validId = styleId && (getTransferStyles(project).some(style => style.id === styleId) || getBuiltInTransferStyle(styleId)) ? styleId : undefined
  const next = structuredClone(project), selected = new Set(stationIds), logicalIds = new Set(next.stations.filter(item => selected.has(item.id)).flatMap(item => getCompoundStationMembers(next, item).map(member => member.id)))
  for (const station of next.stations) if (logicalIds.has(station.id)) {
    if (validId) station.transferStyleId = validId
    else delete station.transferStyleId
  }
  return next
}

export function setProjectDefaultTransferStyle(project: ActualRouteProject, styleId: string): ActualRouteProject {
  if (!getTransferStyles(project).some(style => style.id === styleId) && !getBuiltInTransferStyle(styleId)) return project
  const next = structuredClone(project); next.defaultTransferStyleId = styleId; return next
}

export function createTransferStyle(project: ActualRouteProject, sourceId?: string, name?: string): { project: ActualRouteProject; styleId: string } {
  const source = getTransferStyles(project).find(style => style.id === sourceId) ?? getBuiltInTransferStyle(sourceId) ?? getBuiltInTransferStyle(DEFAULT_TRANSFER_STYLE_ID)!
  const style = structuredClone(source), id = uid('transfer_style')
  style.id = id; style.name = name?.trim() || `${style.name} 副本`; delete style.builtin
  const next = structuredClone(project); next.transferStyles = [...(next.transferStyles ?? []), style]
  return { project: next, styleId: id }
}

export function updateTransferStyle(project: ActualRouteProject, styleId: string, patch: Partial<TransferStyle>): ActualRouteProject {
  const next = structuredClone(project), styles = getTransferStyles(next), index = styles.findIndex(style => style.id === styleId)
  if (index < 0 || styles[index].builtin) return project
  const normalized = normalizeTransferStyle({ ...styles[index], ...patch, id: styleId }, styles[index])
  if (!normalized) return project
  styles[index] = normalized; next.transferStyles = styles; return next
}

export function deleteTransferStyle(project: ActualRouteProject, styleId: string): ActualRouteProject {
  const next = structuredClone(project)
  if (getBuiltInTransferStyle(styleId)) return next
  next.transferStyles = (next.transferStyles ?? []).filter(style => style.id !== styleId)
  for (const station of next.stations) if (station.transferStyleId === styleId) delete station.transferStyleId
  if (next.defaultTransferStyleId === styleId) delete next.defaultTransferStyleId
  return next
}

export const applyTransferStyleToStations = assignTransferStyle
export const resolveLogicalTransferStyle = resolveTransferStyle
