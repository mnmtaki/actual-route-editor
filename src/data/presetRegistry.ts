import type { ActualRouteProject, StationStyle, StationStylePlacement, StationStyleSidePlacementMode, StationStyleTemplate, TransferStyle, TransferStyleTemplate } from './model'
import { uid } from './model'
import { getCompoundStationMembers } from './compoundStation'
import { collapseLinesByServiceFamily } from './lineIdentity'

export type BuiltInPresetType = 'station' | 'transfer'
export interface PresetCompatibility {
  minServiceCount: number
  maxServiceCount?: number
  recommendedServiceCount?: number
}
export interface BuiltInPreset {
  id: string
  displayName: string
  category: string
  applicableType: BuiltInPresetType
  immutable: true
  compatibility: PresetCompatibility
  preview: { serviceCount?: number; lineCodes?: string[]; stationCodes?: string[] }
  renderer: 'station-artwork' | 'transfer-artwork'
  stationStyle?: StationStyle
  transferStyle?: TransferStyle
}

export const KUNMING_TRANSFER_PRESET_ID = 'transfer.kunming'
const LEGACY_TRANSFER_PRESET_ALIASES: Record<string, string> = {
  'transfer.kunming.two': KUNMING_TRANSFER_PRESET_ID,
  'transfer.kunming.three': KUNMING_TRANSFER_PRESET_ID,
}

/** Resolve preset references saved by the pre-dynamic Kunming registry. */
export function canonicalizeTransferPresetId(id: string | undefined): string | undefined {
  if (typeof id !== 'string' || !id.trim()) return undefined
  const normalized = id.trim()
  return LEGACY_TRANSFER_PRESET_ALIASES[normalized] ?? normalized
}

const station = (input: Omit<StationStyle, 'builtin'>): StationStyle => ({ ...input, builtin: true })
const transfer = (input: Omit<TransferStyle, 'builtin'>): TransferStyle => ({ ...input, builtin: true })
const baseStation = (id: string, name: string, shape: StationStyle['shape'], width: number, height: number): StationStyle => station({
  id, name, shape, width, height, lockAspect: shape === 'circle', rotation: 0, cornerRadius: Math.min(height / 2, 3),
  fillEnabled: true, fillColor: 'white', fillOpacity: 1, fillColorMode: 'fixed',
  strokeEnabled: false, strokeColor: '#3f454a', strokeWidth: 0, strokeOpacity: 1, strokeColorMode: 'none',
  haloEnabled: false, haloColor: '#ffffff', haloWidth: 0, haloGap: 0, haloOpacity: 1,
  template: 'standard', placement: 'center', sideOffset: 14, preferredSide: 'auto', markerColorMode: 'fixed', markerColor: 'white', markerPadding: 4,
})
const sideStation = (id: string, name: string, colorMode: 'service' | 'fixed', fillColor: string, sidePlacementMode: StationStyleSidePlacementMode, sideDepthRatio: number, sideThicknessRatio: number): StationStyle => station({
  ...baseStation(id, name, 'square', 18, 11),
  template: 'sideMarker', placement: 'side', sidePlacementMode, sideDepthRatio, sideThicknessRatio, sideOffset: 16, preferredSide: 'auto', markerColorMode: colorMode, markerColor: fillColor,
  lockAspect: false, cornerRadius: 1.5,
})
const numberStation = (id: string, name: string): StationStyle => station({
  ...baseStation(id, name, 'capsule', 40, 18),
  template: 'numberPill', placement: 'center', lockAspect: false, cornerRadius: 9, markerColorMode: 'fixed', markerColor: 'white', markerPadding: 4,
  showLineCode: true, showStationCode: true,
})

const actualRouteTransfer = (id: string, name: string): TransferStyle => transfer({ id, name, template: 'default', shellFill: 'white', shellStroke: '#3f454a', shellStrokeWidth: 1.75, dotsVisible: true, minServiceCount: 2 })
const whiteCapsuleTransfer = (id: string, name: string, template: TransferStyleTemplate): TransferStyle => transfer({ id, name, template, shellFill: 'white', shellStroke: '#3f454a', shellStrokeWidth: 1.75, dotsVisible: false, minServiceCount: 2 })

const PRESETS: BuiltInPreset[] = [
  { id: 'station.actualroute.default', displayName: 'ActualRoute 默认普通站', category: 'ActualRoute', applicableType: 'station', immutable: true, compatibility: { minServiceCount: 1 }, preview: {}, renderer: 'station-artwork', stationStyle: { ...baseStation('station.actualroute.default', 'ActualRoute 默认普通站', 'circle', 11, 11) } },
  { id: 'transfer.actualroute.default', displayName: 'ActualRoute 默认换乘站', category: 'ActualRoute', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2 }, preview: { serviceCount: 2 }, renderer: 'transfer-artwork', transferStyle: actualRouteTransfer('transfer.actualroute.default', 'ActualRoute 默认换乘站') },
  { id: 'station.shanghai.basic', displayName: '上海普通站', category: '上海', applicableType: 'station', immutable: true, compatibility: { minServiceCount: 1 }, preview: {}, renderer: 'station-artwork', stationStyle: sideStation('station.shanghai.basic', '上海普通站', 'service', 'white', 'outward', 1.35, .6) },
  { id: 'transfer.shanghai.default', displayName: '上海换乘站', category: '上海', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2 }, preview: { serviceCount: 2 }, renderer: 'transfer-artwork', transferStyle: whiteCapsuleTransfer('transfer.shanghai.default', '上海换乘站', 'shanghai') },
  { id: 'station.guangzhou.basic', displayName: '广州地铁基本车站', category: '广州', applicableType: 'station', immutable: true, compatibility: { minServiceCount: 1 }, preview: { lineCodes: ['1'], stationCodes: ['01'] }, renderer: 'station-artwork', stationStyle: numberStation('station.guangzhou.basic', '广州地铁基本车站') },
  { id: 'transfer.guangzhou.classic', displayName: '广州地铁换乘车站（经典）', category: '广州', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2, maxServiceCount: 4, recommendedServiceCount: 2 }, preview: { serviceCount: 2, lineCodes: ['1', '2'], stationCodes: ['01', '02'] }, renderer: 'transfer-artwork', transferStyle: transfer({ id: 'transfer.guangzhou.classic', name: '广州地铁换乘车站（经典）', template: 'guangzhouClassic', shellFill: 'white', shellStroke: '#3f454a', shellStrokeWidth: 1.25, dotsVisible: false, minServiceCount: 2, maxServiceCount: 4, recommendedServiceCount: 2 }) },
  { id: 'transfer.guangzhou.2024', displayName: '广州地铁换乘车站（2024）', category: '广州', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2 }, preview: { serviceCount: 4, lineCodes: ['1', '3', '7', '8'], stationCodes: ['01', '03', '05', '02'] }, renderer: 'transfer-artwork', transferStyle: transfer({ id: 'transfer.guangzhou.2024', name: '广州地铁换乘车站（2024）', template: 'guangzhou2024', shellFill: 'white', shellStroke: '#3f454a', shellStrokeWidth: 1.25, dotsVisible: false, minServiceCount: 2 }) },
  { id: 'transfer.beijing.default', displayName: '北京地铁换乘车站', category: '北京', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2 }, preview: { serviceCount: 2 }, renderer: 'transfer-artwork', transferStyle: whiteCapsuleTransfer('transfer.beijing.default', '北京地铁换乘车站', 'beijing') },
  { id: KUNMING_TRANSFER_PRESET_ID, displayName: '昆明地铁换乘站', category: '昆明', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2 }, preview: { serviceCount: 2 }, renderer: 'transfer-artwork', transferStyle: transfer({ id: KUNMING_TRANSFER_PRESET_ID, name: '昆明地铁换乘站', template: 'kunming', shellFill: 'white', shellStroke: '#3f454a', shellStrokeWidth: 1.75, dotsVisible: false, minServiceCount: 2 }) },
  { id: 'station.metroman.basic', displayName: '地铁通基本车站', category: '地铁通', applicableType: 'station', immutable: true, compatibility: { minServiceCount: 1 }, preview: {}, renderer: 'station-artwork', stationStyle: sideStation('station.metroman.basic', '地铁通基本车站', 'fixed', 'white', 'inward', .5, .36) },
  { id: 'transfer.metroman.default', displayName: '地铁通换乘车站', category: '地铁通', applicableType: 'transfer', immutable: true, compatibility: { minServiceCount: 2 }, preview: { serviceCount: 2 }, renderer: 'transfer-artwork', transferStyle: whiteCapsuleTransfer('transfer.metroman.default', '地铁通换乘车站', 'metroman') },
]

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

export const BUILTIN_PRESET_REGISTRY: readonly BuiltInPreset[] = Object.freeze(PRESETS.map(preset => deepFreeze(preset)))

export function getBuiltInPresets(type?: BuiltInPresetType): BuiltInPreset[] {
  return BUILTIN_PRESET_REGISTRY.filter(preset => !type || preset.applicableType === type).map(preset => structuredClone(preset))
}

export const getPresetRegistry = getBuiltInPresets

export function getBuiltInPreset(id: string): BuiltInPreset | undefined {
  const preset = BUILTIN_PRESET_REGISTRY.find(item => item.id === canonicalizeTransferPresetId(id))
  return preset ? structuredClone(preset) : undefined
}

export function getBuiltInStationStyle(id: string | undefined): StationStyle | undefined {
  const preset = BUILTIN_PRESET_REGISTRY.find(item => item.id === id && item.applicableType === 'station')
  return preset?.stationStyle ? structuredClone(preset.stationStyle) : undefined
}

export function getBuiltInTransferStyle(id: string | undefined): TransferStyle | undefined {
  const preset = BUILTIN_PRESET_REGISTRY.find(item => item.id === canonicalizeTransferPresetId(id) && item.applicableType === 'transfer')
  return preset?.transferStyle ? structuredClone(preset.transferStyle) : undefined
}

export function isPresetCompatible(presetOrId: BuiltInPreset | string, serviceCount: number): boolean {
  const preset = typeof presetOrId === 'string' ? getBuiltInPreset(presetOrId) : presetOrId
  if (!preset || !Number.isFinite(serviceCount)) return false
  return serviceCount >= preset.compatibility.minServiceCount && (preset.compatibility.maxServiceCount === undefined || serviceCount <= preset.compatibility.maxServiceCount)
}

export function presetCompatibilityMessage(presetOrId: BuiltInPreset | string, serviceCount: number): string | null {
  const preset = typeof presetOrId === 'string' ? getBuiltInPreset(presetOrId) : presetOrId
  if (!preset || isPresetCompatible(preset, serviceCount)) return null
  if (preset.compatibility.maxServiceCount !== undefined) return `${preset.displayName}仅适用于${preset.compatibility.minServiceCount}–${preset.compatibility.maxServiceCount}线换乘。`
  return `${preset.displayName}至少需要${preset.compatibility.minServiceCount}线换乘。`
}

export function copyPresetToCustom(project: ActualRouteProject, presetId: string, name?: string): { project: ActualRouteProject; styleId: string } {
  const preset = getBuiltInPreset(presetId)
  if (!preset) return { project, styleId: '' }
  const next = structuredClone(project)
  const id = uid(preset.applicableType === 'station' ? 'station_style' : 'transfer_style')
  if (preset.applicableType === 'station' && preset.stationStyle) {
    const style = structuredClone(preset.stationStyle)
    style.id = id; style.name = name?.trim() || `${style.name} 副本`; delete style.builtin
    next.stationStyles = [...(next.stationStyles ?? []), style]
  } else if (preset.applicableType === 'transfer' && preset.transferStyle) {
    const style = structuredClone(preset.transferStyle)
    style.id = id; style.name = name?.trim() || `${style.name} 副本`; delete style.builtin
    next.transferStyles = [...(next.transferStyles ?? []), style]
  }
  return { project: next, styleId: id }
}

export function applyPresetToStations(project: ActualRouteProject, stationIds: string[], presetId: string): ActualRouteProject {
  const preset = getBuiltInPreset(presetId)
  if (!preset) return project
  if (preset.applicableType === 'transfer') {
    const selected = new Set(stationIds)
    const logicalIds = new Set(project.stations.filter(item => selected.has(item.id)).flatMap(item => getCompoundStationMembers(project, item).map(member => member.id)))
    const counts = [...new Set(project.stations.filter(item => logicalIds.has(item.id)).map(item => {
      const lines = project.stationLineRelations
        .filter(relation => getCompoundStationMembers(project, item).some(member => member.id === relation.stationId))
        .map(relation => project.lines.find(line => line.id === relation.lineId))
        .filter((line): line is NonNullable<typeof line> => Boolean(line))
      return collapseLinesByServiceFamily(project, lines).length
    }))]
    if (counts.some(count => !isPresetCompatible(preset, count))) return project
  }
  const next = structuredClone(project)
  const ids = new Set(stationIds)
  if (preset.applicableType === 'station') {
    for (const item of next.stations) if (ids.has(item.id)) item.stationStyleId = preset.id
  } else {
    const logicalIds = new Set(next.stations.filter(item => ids.has(item.id)).flatMap(item => getCompoundStationMembers(next, item).map(member => member.id)))
    for (const item of next.stations) if (logicalIds.has(item.id)) item.transferStyleId = preset.id
  }
  return next
}

export function setDefaultPreset(project: ActualRouteProject, type: BuiltInPresetType, presetId: string): ActualRouteProject {
  const canonicalId = canonicalizeTransferPresetId(presetId)
  const preset = BUILTIN_PRESET_REGISTRY.find(item => item.id === canonicalId && item.applicableType === type)
  if (!preset) return project
  const next = structuredClone(project)
  if (type === 'station') next.defaultStationStyleId = preset.id
  else next.defaultTransferStyleId = preset.id
  return next
}

export const applyBuiltInPreset = applyPresetToStations
export const copyBuiltInPreset = copyPresetToCustom
