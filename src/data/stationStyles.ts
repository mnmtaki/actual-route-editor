import { uid } from './model'
import type { ActualRouteProject, Station, StationStyle, StationStyleColorMode, StationStyleMarkerColorMode, StationStylePlacement, StationStyleSidePlacementMode, StationStyleTemplate, StationStyleShape } from './model'
import { getBuiltInStationStyle } from './presetRegistry'

export const DEFAULT_STATION_STYLE_ID = 'default'

export function createDefaultStationStyle(size = 11): StationStyle {
  const safeSize = positive(size, 11)
  return {
    id: DEFAULT_STATION_STYLE_ID,
    name: '默认普通站',
    shape: 'circle',
    width: safeSize,
    height: safeSize,
    lockAspect: true,
    rotation: 0,
    cornerRadius: 0,
    fillEnabled: true,
    fillColor: 'white',
    fillOpacity: 1,
    fillColorMode: 'fixed',
    strokeEnabled: false,
    strokeColor: '#ffffff',
    strokeWidth: 0,
    strokeOpacity: 1,
    strokeColorMode: 'none',
    haloEnabled: false,
    haloColor: '#ffffff',
    haloWidth: 0,
    haloGap: 0,
    haloOpacity: 1,
    template: 'standard',
    placement: 'center',
    sidePlacementMode: 'outward',
    sideDepthRatio: 1,
    sideThicknessRatio: .6,
    sideOffset: 14,
    preferredSide: 'auto',
    markerColorMode: 'fixed',
    markerColor: 'white',
    markerPadding: 4,
    showLineCode: false,
    showStationCode: false,
    builtin: true,
  }
}

const shapes: StationStyleShape[] = ['circle', 'square', 'roundedRect', 'capsule', 'diamond']
const colorModes: StationStyleColorMode[] = ['fixed', 'background', 'none']
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const positive = (value: unknown, fallback: number) => Math.max(0.01, finite(value, fallback))
const nonNegative = (value: unknown, fallback: number) => Math.max(0, finite(value, fallback))
const opacity = (value: unknown, fallback: number) => Math.max(0, Math.min(1, finite(value, fallback)))
const color = (value: unknown, fallback: string) => typeof value === 'string' && (value.trim().toLowerCase() === 'white' || /^#[0-9a-f]{6}$/i.test(value.trim())) ? value.trim().toLowerCase() : fallback
const mode = (value: unknown, fallback: StationStyleColorMode): StationStyleColorMode => typeof value === 'string' && colorModes.includes(value as StationStyleColorMode) ? value as StationStyleColorMode : fallback
const templates: StationStyleTemplate[] = ['standard', 'sideMarker', 'numberPill']
const placements: StationStylePlacement[] = ['center', 'side']
const markerModes: StationStyleMarkerColorMode[] = ['fixed', 'service']
const sidePlacementModes: StationStyleSidePlacementMode[] = ['outward', 'inward']

export function normalizeStationStyle(value: unknown, fallback?: StationStyle): StationStyle | null {
  if (!value || typeof value !== 'object') return fallback ? { ...fallback } : null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fallback?.id ?? ''
  if (!id) return fallback ? { ...fallback } : null
  const base = fallback ?? createDefaultStationStyle()
  const shape = typeof raw.shape === 'string' && shapes.includes(raw.shape as StationStyleShape) ? raw.shape as StationStyleShape : base.shape
  const lockAspect = raw.lockAspect !== false
  const width = positive(raw.width, base.width)
  const template = typeof raw.template === 'string' && templates.includes(raw.template as StationStyleTemplate) ? raw.template as StationStyleTemplate : (base.template ?? 'standard')
  const placement = typeof raw.placement === 'string' && placements.includes(raw.placement as StationStylePlacement) ? raw.placement as StationStylePlacement : (base.placement ?? 'center')
  const sidePlacementMode = typeof raw.sidePlacementMode === 'string' && sidePlacementModes.includes(raw.sidePlacementMode as StationStyleSidePlacementMode) ? raw.sidePlacementMode as StationStyleSidePlacementMode : (base.sidePlacementMode ?? 'outward')
  const markerColorMode = typeof raw.markerColorMode === 'string' && markerModes.includes(raw.markerColorMode as StationStyleMarkerColorMode) ? raw.markerColorMode as StationStyleMarkerColorMode : (base.markerColorMode ?? 'fixed')
  const preferredSide = raw.preferredSide === 'left' || raw.preferredSide === 'right' ? raw.preferredSide : (base.preferredSide ?? 'auto')
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : base.name,
    shape,
    width,
    height: lockAspect ? width : positive(raw.height, base.height),
    lockAspect,
    rotation: finite(raw.rotation, base.rotation),
    cornerRadius: nonNegative(raw.cornerRadius, base.cornerRadius),
    fillEnabled: raw.fillEnabled !== false,
    fillColor: color(raw.fillColor, base.fillColor),
    fillOpacity: opacity(raw.fillOpacity, base.fillOpacity),
    fillColorMode: mode(raw.fillColorMode, base.fillColorMode),
    strokeEnabled: raw.strokeEnabled === true,
    strokeColor: color(raw.strokeColor, base.strokeColor),
    strokeWidth: nonNegative(raw.strokeWidth, base.strokeWidth),
    strokeOpacity: opacity(raw.strokeOpacity, base.strokeOpacity),
    strokeColorMode: mode(raw.strokeColorMode, base.strokeColorMode),
    haloEnabled: raw.haloEnabled === true,
    haloColor: color(raw.haloColor, base.haloColor),
    haloWidth: nonNegative(raw.haloWidth, base.haloWidth),
    haloGap: nonNegative(raw.haloGap, base.haloGap),
    haloOpacity: opacity(raw.haloOpacity, base.haloOpacity),
    template,
    placement,
    sidePlacementMode,
    sideDepthRatio: positive(raw.sideDepthRatio, base.sideDepthRatio ?? 1),
    sideThicknessRatio: positive(raw.sideThicknessRatio, base.sideThicknessRatio ?? .6),
    sideOffset: nonNegative(raw.sideOffset, base.sideOffset ?? 14),
    preferredSide,
    markerColorMode,
    markerColor: color(raw.markerColor, base.markerColor ?? 'white'),
    markerPadding: nonNegative(raw.markerPadding, base.markerPadding ?? 4),
    showLineCode: raw.showLineCode === true || (raw.showLineCode === undefined && base.showLineCode === true),
    showStationCode: raw.showStationCode === true || (raw.showStationCode === undefined && base.showStationCode === true),
    ...(id === DEFAULT_STATION_STYLE_ID ? { builtin: true } : {}),
  }
}

export function normalizeStationStyles(value: unknown, legacySize = 11): StationStyle[] | undefined {
  if (!Array.isArray(value)) return undefined
  const fallback = createDefaultStationStyle(legacySize)
  const result: StationStyle[] = []
  for (const item of value) {
    const normalized = normalizeStationStyle(item, undefined)
    if (!normalized || result.some(style => style.id === normalized.id)) continue
    result.push(normalized)
  }
  const defaultIndex = result.findIndex(style => style.id === DEFAULT_STATION_STYLE_ID)
  if (defaultIndex < 0) result.unshift(fallback)
  else result[defaultIndex] = normalizeStationStyle(result[defaultIndex], fallback)!
  return result
}

export function getStationStyles(project: ActualRouteProject): StationStyle[] {
  const fallback = createDefaultStationStyle(project.settings?.stationSize)
  const saved: unknown[] = Array.isArray(project.stationStyles) ? project.stationStyles : []
  const savedDefault = saved.find(style => Boolean(style && typeof style === 'object' && (style as { id?: unknown }).id === DEFAULT_STATION_STYLE_ID))
  const result: StationStyle[] = [normalizeStationStyle(savedDefault, fallback)!]
  for (const style of saved) {
    if (!style || typeof style !== 'object') continue
    const id = (style as { id?: unknown }).id
    if (id === DEFAULT_STATION_STYLE_ID || typeof id !== 'string' || result.some(item => item.id === id)) continue
    const normalized = normalizeStationStyle(style)
    if (normalized) result.push(normalized)
  }
  return result
}

export function ensureProjectStationStyles(project: ActualRouteProject): StationStyle[] {
  return getStationStyles(project).map(style => ({ ...style }))
}

export function resolveStationStyle(project: ActualRouteProject, station: Station): StationStyle {
  const styles = getStationStyles(project)
  const fallback = styles.find(style => style.id === DEFAULT_STATION_STYLE_ID) ?? createDefaultStationStyle(project.settings?.stationSize)
  const projectDefaultId = project.defaultStationStyleId ?? DEFAULT_STATION_STYLE_ID
  const projectDefault = styles.find(style => style.id === projectDefaultId) ?? getBuiltInStationStyle(projectDefaultId) ?? fallback
  const selected = station.stationStyleId === undefined ? projectDefault : styles.find(style => style.id === station.stationStyleId) ?? getBuiltInStationStyle(station.stationStyleId) ?? projectDefault
  // Build 16/legacy projects may still carry a sparse stationSize override. Keep
  // that old visual contract until the station receives a StationStyle reference.
  const legacySize = station.stationStyleId === undefined ? station.styleOverrides?.stationSize : undefined
  if (typeof legacySize === 'number' && Number.isFinite(legacySize) && legacySize > 0) {
    return { ...selected, width: legacySize, height: selected.lockAspect ? legacySize : selected.height }
  }
  return { ...selected }
}

export function setProjectDefaultStationStyle(project: ActualRouteProject, styleId: string): ActualRouteProject {
  const next = structuredClone(project)
  if (getStationStyles(next).some(style => style.id === styleId) || getBuiltInStationStyle(styleId)) next.defaultStationStyleId = styleId
  return next
}

export const setDefaultStationStyle = setProjectDefaultStationStyle

export function assignStationStyle(project: ActualRouteProject, stationIds: string[], styleId?: string): ActualRouteProject {
  const next = structuredClone(project)
  const validId = styleId && (getStationStyles(next).some(style => style.id === styleId) || getBuiltInStationStyle(styleId)) ? styleId : undefined
  const ids = new Set(stationIds)
  for (const station of next.stations) {
    if (!ids.has(station.id)) continue
    if (validId) station.stationStyleId = validId
    else delete station.stationStyleId
  }
  return next
}

export const applyStationStyleToStations = assignStationStyle
export const setStationStyleForStations = assignStationStyle

export function deleteStationStyle(project: ActualRouteProject, styleId: string): ActualRouteProject {
  const next = structuredClone(project)
  if (styleId === DEFAULT_STATION_STYLE_ID) return next
  next.stationStyles = (next.stationStyles ?? []).filter(style => style.id !== styleId)
  for (const station of next.stations) if (station.stationStyleId === styleId) delete station.stationStyleId
  if (next.defaultStationStyleId === styleId) delete next.defaultStationStyleId
  return next
}

/** Create a user-owned style from an existing library entry. */
export function createStationStyle(project: ActualRouteProject, sourceId?: string, name?: string): { project: ActualRouteProject; styleId: string } {
  const styles = getStationStyles(project)
  const source = styles.find(style => style.id === sourceId) ?? getBuiltInStationStyle(sourceId) ?? styles[0]
  const existingIds = new Set(styles.map(style => style.id))
  let styleId = uid('station_style')
  while (existingIds.has(styleId)) styleId = uid('station_style')
  const copy = structuredClone(source ?? createDefaultStationStyle(project.settings?.stationSize))
  copy.id = styleId
  copy.name = name?.trim() || `${copy.name} ${styles.length + 1}`
  delete copy.builtin
  const next = structuredClone(project)
  next.stationStyles = [...ensureProjectStationStyles(next), copy]
  return { project: next, styleId }
}

/** Update one persisted style while keeping all unrelated project data intact. */
export function updateStationStyle(project: ActualRouteProject, styleId: string, patch: Partial<StationStyle>): ActualRouteProject {
  const next = structuredClone(project)
  const styles = ensureProjectStationStyles(next)
  const index = styles.findIndex(style => style.id === styleId)
  if (index < 0) return project
  const target = styles[index]
  const normalized = normalizeStationStyle({ ...target, ...patch, id: styleId }, target)
  if (!normalized) return project
  styles[index] = normalized
  next.stationStyles = styles
  return next
}

export function renameStationStyle(project: ActualRouteProject, styleId: string, name: string): ActualRouteProject {
  return updateStationStyle(project, styleId, { name: name.trim() || '未命名车站样式' })
}
